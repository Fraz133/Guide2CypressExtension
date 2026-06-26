// --- START OF FILE sidepanel.js ---

document.addEventListener('DOMContentLoaded', () => {
    // Page containers
    const pageOne = document.getElementById('page-one-start');
    const pageTwo = document.getElementById('page-two-recording');
    const pageThree = document.getElementById('page-three-export');

    // Page 1 controls
    const startRecordBtn = document.getElementById('start-record-btn');

    // Page 2 controls
    const stepsListDiv = document.getElementById('steps-list');
    const stepsListContainer = document.getElementById('steps-list-container');
    const stopRecordingBtn = document.getElementById('stop-recording-btn');
    const assertionsBtn = document.getElementById('assertions-btn');
    const visualAssertionBtn = document.getElementById('visual-assertion-btn');
    
    // Configuration input elements
    const loginUrlInput = document.getElementById('login-url');
    const testUsernameInput = document.getElementById('test-username');
    const testPasswordInput = document.getElementById('test-password');
    const testOtpInput = document.getElementById('test-otp');

    // Page 3 controls
    const closeExportBtn = document.getElementById('close-export-btn');
    const sendToVSCodeBtn = document.getElementById('send-to-vscode-btn');
    const copyStepsBtn = document.getElementById('copy-steps-btn');
    const generateAndCopyBtn = document.getElementById('generate-steps-btn');

    // Page 4 (Assertion) controls
    const pageFour = document.getElementById('page-four-assertion');
    const assertionPageTitle = document.getElementById('assertion-page-title');
    const closeAssertionBtn = document.getElementById('close-assertion-btn');
    const instructionView = document.getElementById('assertion-instruction-view');
    const optionsView = document.getElementById('assertion-options-view');
    const optionsListDiv = document.getElementById('assertion-options-list');
    const addAssertionsBtn = document.getElementById('add-assertions-btn');

    const instructionIllustration = document.getElementById('instruction-illustration');
    
    
    // Global state
    const STEPS_STORAGE_KEY = 'recordedSteps';
    let currentAssertionTarget = null;
    let isInspecting = false;
    
    // Configuration storage keys
    const CONFIG_KEYS = {
        loginUrl: 'g2c_loginUrl',
        testUsername: 'g2c_testUsername', 
        testPassword: 'g2c_testPassword',
        testOtp: 'g2c_testOtp'
    };
    
    // --- Page Navigation ---
    function showPage(pageId) {
        [pageOne, pageTwo, pageThree, pageFour].forEach(page => {
            page.classList.toggle('active', page.id === pageId);
        });
    }
    
    // --- Event Listeners ---
    startRecordBtn.addEventListener('click', handleStartRecording);
    stopRecordingBtn.addEventListener('click', handleStopRecording);
    assertionsBtn.addEventListener('click', handleAssertionClick);
    visualAssertionBtn.addEventListener('click', handleVisualAssertionClick);
    
    closeExportBtn.addEventListener('click', handleEndTestCase);
    sendToVSCodeBtn.addEventListener('click', handleSendToVSCode);
    copyStepsBtn.addEventListener('click', handleCopySteps);
    generateAndCopyBtn.addEventListener('click', handleGenerateAndCopy);

    closeAssertionBtn.addEventListener('click', handleCloseAssertionPage);
    addAssertionsBtn.addEventListener('click', handleAddAssertions);
    
    // Configuration input event listeners
    loginUrlInput.addEventListener('input', () => saveConfigValue('loginUrl', loginUrlInput.value));
    testUsernameInput.addEventListener('input', () => saveConfigValue('testUsername', testUsernameInput.value));
    testPasswordInput.addEventListener('input', () => saveConfigValue('testPassword', testPasswordInput.value));
    testOtpInput.addEventListener('input', () => saveConfigValue('testOtp', testOtpInput.value));

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes[STEPS_STORAGE_KEY]) {
            displayRecordedActions();
        }
        if (namespace === 'local' && changes.isRecording) {
            if (!changes.isRecording.newValue) {
                // If recording has been stopped from another source, ensure UI is on export page
                showPage('page-three-export');
            }
        }
    });

    chrome.runtime.onMessage.addListener(async (message) => {
        if (message.type === 'AXE_AUDIT_COMPLETE') {
            const { accessibilityViolations } = await chrome.storage.local.get('accessibilityViolations');
            const allViolations = accessibilityViolations || []; // Initialize if it doesn't exist
            allViolations.push(message.audit); // Add the new page's violations
            await chrome.storage.local.set({ accessibilityViolations: allViolations });
        } else if (message.type === 'LOADER_TIME_CAPTURED') {
            const { recordedSteps } = await chrome.storage.local.get('recordedSteps');
            if (recordedSteps && recordedSteps.length > 0) {
                // Find the EXACT click that triggered the loader using its timestamp
                const stepToUpdate = recordedSteps.find(step => step.timestamp === message.clickTimestamp);
                
                if (stepToUpdate) {
                    stepToUpdate.pageLoadTime = message.duration;
                    await chrome.storage.local.set({ recordedSteps: recordedSteps });
                }
            }
        } else if (message.type === 'INSPECTION_COMPLETE') {
            isInspecting = false;
            currentAssertionTarget = {
                selector: message.selector,
                xpath: message.xpath,
                details: message.details
            };
            const supportedTypes = ['Text', 'Button', 'Link', 'Input', 'Image'];
            if (supportedTypes.includes(message.details.elementType)) {
                showAssertionOptions(message.details);
            } else {
                handleDefaultAssertion();
            }
        } else if (message.type === 'INSPECTION_VISUAL_COMPLETE') {
            isInspecting = false;
            const visualStep = {
                action: 'visualAssert',
                selector: message.selector,
                xpath: message.xpath,
                snapshotName: message.snapshotName,
                snapshotData_base64: message.snapshotData_base64,
                timestamp: Date.now()
            };
            await addStepsToStorage([visualStep]);
            showPage('page-two-recording');
        } else if (message.type === 'INSPECTION_FAILED') {
            isInspecting = false;
            alert("Could not identify a unique selector for the element. Please try another one.");
            showPage('page-two-recording');
        }
    });

    // --- Core Functionality Handlers ---
    async function handleStartRecording() {
        await chrome.storage.local.remove('accessibilityViolations');
        await chrome.storage.local.set({ [STEPS_STORAGE_KEY]: [], isRecording: true });
        
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab?.id) {
            try {
                // Add the first "visit" step automatically
                const firstStep = {
                    action: 'visit',
                    url: activeTab.url,
                    label: `Visit ${activeTab.url}`,
                    timestamp: Date.now()
                };
                await chrome.storage.local.set({ [STEPS_STORAGE_KEY]: [firstStep] });
                await chrome.tabs.sendMessage(activeTab.id, { type: 'START_RECORDING' });
            } catch (e) {
                console.error("Failed to send start message to content script.", e);
            }
        }
        showPage('page-two-recording');
    }

    async function handleStopRecording() {
          const { accessibilityViolations } = await chrome.storage.local.get('accessibilityViolations');
        if (accessibilityViolations && accessibilityViolations.length > 0) {
            console.log("--- ♿ Accessibility Audit Report ---");
            console.log("The following issues were found during the recording session:");
            // We use JSON.stringify for a clean, expandable object in the console
            console.log(JSON.stringify(accessibilityViolations, null, 2));
            console.log("------------------------------------");
        } else {
            console.log("--- ♿ Accessibility Audit Report ---");
            console.log("No accessibility violations were found during the recording session. Great job!");
            console.log("------------------------------------");
        }
        await chrome.storage.local.set({ isRecording: false });

        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab?.id) {
            try {
                await chrome.tabs.sendMessage(activeTab.id, { type: 'STOP_RECORDING' });
            } catch (e) {
                 console.error("Failed to send stop message to content script.", e);
            }
        }
        showPage('page-three-export');
    }

    async function startInspectionMode(mode) {
        isInspecting = true;
        
        // Show the main assertion page container
        showPage('page-four-assertion');
        
        // Ensure the correct view is visible
        instructionView.style.display = 'flex';
        optionsView.style.display = 'none';

        // Customize the view based on the mode
        if (mode === 'visual') {
            assertionPageTitle.textContent = 'Visual Assertion';
            instructionView.classList.add('visual-mode-background');
            instructionIllustration.classList.add('visual-illustration');
            
        } else {
            // This is for a regular assertion, set its defaults
            assertionPageTitle.textContent = 'Assertion';
            instructionView.classList.remove('visual-mode-background');
            instructionIllustration.classList.remove('visual-illustration');
            
        }

        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab?.id) {
            try {
                await chrome.tabs.sendMessage(activeTab.id, { type: 'START_INSPECTING', mode: mode });
            } catch (e) {
                console.error(`Failed to send START_INSPECTING message.`, e);
                isInspecting = false;
                showPage('page-two-recording'); // Go back if it fails
            }
        }
    }

    async function handleAssertionClick() {
        // Start inspection in 'assertion' mode
        await startInspectionMode('assertion');
    }

    // ADD this new function
    async function handleVisualAssertionClick() {
        // Start inspection in 'visual' mode
        await startInspectionMode('visual');
    }

    function showAssertionOptions(details) {
        // Show the correct view
        instructionView.style.display = 'none';
        optionsView.style.display = 'flex';
        assertionPageTitle.innerHTML = `Assertion on &lt;${details.tagName}&gt;`;

        optionsListDiv.innerHTML = ''; // Clear previous options
        let uiHtml = '';

        // Dynamically build the UI based on the element type
        switch (details.elementType) {
            case 'Text':
                uiHtml = `
                    <label class="assertion-item"><input type="checkbox" data-type="textContains" checked> contains text: <input type="text" value="${details.attributes.innerText}"></label>
                    <label class="assertion-item"><input type="checkbox" data-type="visible"> is visible</label>
                    <label class="assertion-item"><input type="checkbox" data-type="exists"> exists in the DOM</label>
                `;
                break;
            case 'Button':
                uiHtml = `
                    <label class="assertion-item"><input type="radio" name="enabled-state" data-type="enabled"> is enabled</label>
                    <label class="assertion-item"><input type="radio" name="enabled-state" data-type="disabled"> is disabled</label>
                    <hr>
                    <label class="assertion-item"><input type="checkbox" data-type="textContains" checked> contains text: <input type="text" value="${details.attributes.innerText}"></label>
                    <label class="assertion-item"><input type="checkbox" data-type="visible"> is visible</label>
                `;
                break;
            case 'Link':
                uiHtml = `
                    <label class="assertion-item"><input type="checkbox" data-type="attribute" data-attr="href" checked> link (href) contains: <input type="text" value="${details.attributes.href}"></label>
                    <label class="assertion-item"><input type="checkbox" data-type="textContains"> contains text: <input type="text" value="${details.attributes.innerText}"></label>
                    <label class="assertion-item"><input type="checkbox" data-type="visible"> is visible</label>
                `;
                break;
            case 'Input':
                 uiHtml = `
                    <label class="assertion-item"><input type="checkbox" data-type="value" checked> has value: <input type="text" value="${details.attributes.value}"></label>
                    ${details.attributes.placeholder ? `<label class="assertion-item"><input type="checkbox" data-type="placeholder"> has placeholder: <input type="text" value="${details.attributes.placeholder}"></label>` : ''}
                    <hr>
                    <label class="assertion-item"><input type="radio" name="enabled-state" data-type="enabled"> is enabled</label>
                    <label class="assertion-item"><input type="radio" name="enabled-state" data-type="disabled"> is disabled</label>
                `;
                break;
            case 'Image':
                uiHtml = `
                    <label class="assertion-item"><input type="checkbox" data-type="visible" checked> is visible</label>
                    <label class="assertion-item"><input type="checkbox" data-type="attribute" data-attr="alt"> has alt text: <input type="text" value="${details.attributes.alt}"></label>
                    <label class="assertion-item"><input type="checkbox" data-type="attribute" data-attr="src"> source URL contains: <input type="text" value="${details.attributes.href}"></label>
                `;
                break;
        }
        optionsListDiv.innerHTML = uiHtml;
    }

    // --- In sidepanel.js, add these new helper functions ---

    async function handleDefaultAssertion() {
        if (!currentAssertionTarget) return;

        // For non-specific elements, create a single, simple 'exists' assertion
        const defaultStep = {
            action: 'assert',
            selector: currentAssertionTarget.selector,
            xpath: currentAssertionTarget.xpath,
            assertionType: 'exists',
            expectedValue: true,
            label: `Assert element exists`,
            timestamp: Date.now()
        };
        
        await addStepsToStorage([defaultStep]);

        // Clean up and go back
        currentAssertionTarget = null;
        showPage('page-two-recording');
    }

    async function addStepsToStorage(newSteps) {
        if (!newSteps || newSteps.length === 0) return;
        try {
            const result = await chrome.storage.local.get(STEPS_STORAGE_KEY);
            const currentSteps = result[STEPS_STORAGE_KEY] || [];
            const updatedSteps = currentSteps.concat(newSteps);
            await chrome.storage.local.set({ [STEPS_STORAGE_KEY]: updatedSteps });
        } catch (e) {
            console.error("Failed to add steps to storage:", e);
        }
    }

    async function handleAddAssertions() {
        if (!currentAssertionTarget) return;

        const newSteps = [];
        const optionElements = optionsListDiv.querySelectorAll('input[type="checkbox"], input[type="radio"]');

        optionElements.forEach(input => {
            if (!input.checked) return;

            const step = {
                action: 'assert',
                selector: currentAssertionTarget.selector,
                xpath: currentAssertionTarget.xpath,
                label: `Assert on ${currentAssertionTarget.details.tagName}`,
                timestamp: Date.now()
            };

            const assertionType = input.dataset.type;
            step.assertionType = assertionType;

            switch (assertionType) {
                case 'textContains':
                case 'value':
                case 'placeholder':
                    step.expectedValue = input.parentElement.querySelector('input[type="text"]').value;
                    break;
                case 'attribute':
                    step.attributeName = input.dataset.attr;
                    step.expectedValue = input.parentElement.querySelector('input[type="text"]').value;
                    break;
                case 'enabled':
                case 'disabled':
                case 'visible':
                case 'exists':
                    step.expectedValue = true; // These are boolean checks
                    break;
            }
            newSteps.push(step);
        });

        if (newSteps.length > 0) {
            await addStepsToStorage(newSteps);
        }

        // Clean up and go back to the recording page
        currentAssertionTarget = null;
        showPage('page-two-recording');
    }
    
    function handleCloseAssertionPage() {
        // If user closes the page, we must stop inspecting
        if (isInspecting) {
            isInspecting = false;
            // Send a message to the content script to stop the highlight effect
            chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
                if(tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'STOP_INSPECTING' });
            });
        }
        
        // IMPORTANT: Clean up the UI for the next time it's opened
        instructionView.classList.remove('visual-mode-background');
        instructionIllustration.classList.remove('visual-illustration');
        
        // Navigate back to the main recording page
        showPage('page-two-recording');
    }

        async function handleEndTestCase() {
       
        if (confirm("Are you sure you want to end this test case. All recorded steps will be cleared.")) { 
            await chrome.storage.local.remove(STEPS_STORAGE_KEY);
            showPage('page-one-start');
        }
    }
    async function handleSendToVSCode() {
        // Provide immediate feedback to the user
        const originalButtonText = sendToVSCodeBtn.textContent;
        sendToVSCodeBtn.textContent = 'Sending...';
        sendToVSCodeBtn.disabled = true;

        try {
            // 1. Gather all the data to be sent
            const { recordedSteps } = await chrome.storage.local.get('recordedSteps');
            const { accessibilityViolations } = await chrome.storage.local.get('accessibilityViolations');

            // Get configuration values
            const configData = await chrome.storage.local.get(Object.values(CONFIG_KEYS));
            
            const payload = {
                steps: recordedSteps || [],
                accessibilityReport: accessibilityViolations || [],
                loginUrl: configData[CONFIG_KEYS.loginUrl] || '',
                testUsername: configData[CONFIG_KEYS.testUsername] || '',
                testPassword: configData[CONFIG_KEYS.testPassword] || '',
                testOtp: configData[CONFIG_KEYS.testOtp] || ''
            };

            // 2. Define the target URL for the VS Code server
            const url = 'http://localhost:3000/handoff';

            // 3. Send the data using the Fetch API
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                // Handle cases where the server is not running or there's a network error
                throw new Error(`The VS Code listener is not active or responded with an error: ${response.statusText}`);
            }

            const result = await response.json();
            console.log('Handoff successful:', result);
            alert('Test data successfully sent to VS Code!');

            // Optional: After a successful send, you could reset the test case.
            // For now, we will leave the user on the export page.
            // handleEndTestCase(); // You could call this to auto-reset.

        } catch (error) {
            console.error('Failed to send data to VS Code:', error);
            alert(`Handoff Failed: Could not connect to the VS Code listener. Please ensure the listener is active in VS Code and try again.\n\nError: ${error.message}`);
        } finally {
            // Re-enable the button and restore its text, whether it succeeded or failed
            sendToVSCodeBtn.textContent = originalButtonText;
            sendToVSCodeBtn.disabled = false;
        }
    }

    async function handleCopySteps() {
        try {
            const result = await chrome.storage.local.get(STEPS_STORAGE_KEY);
            const steps = result[STEPS_STORAGE_KEY] || [];
            await navigator.clipboard.writeText(JSON.stringify(steps, null, 2));
            alert('Recorded steps copied to clipboard!');
        } catch (e) {
            console.error("Failed to copy steps.", e);
            alert("Failed to copy steps.");
        }
    }
        async function handleGenerateAndCopy() {
        alert("Generating Cypress code... Please wait.");
        
        // --- 1. Azure OpenAI API Configuration ---
        // IMPORTANT: Replace with your actual Azure credentials
        const endpoint = "https://omar-mcxhejf5-eastus2.cognitiveservices.azure.com/";
        const deployment = "model-router";
        const apiKey = "YOUR_AZURE_API_KEY_HERE"; // <-- REPLACE THIS
        const apiVersion = "2024-05-01-preview";
        
        // Construct the final URL for the REST API call
        const fullUrl = `${endpoint}openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

        try {
            // --- 2. Get Recorded Steps ---
            const result = await chrome.storage.local.get(STEPS_STORAGE_KEY);
            const steps = result?.[STEPS_STORAGE_KEY] || [];

            if (steps.length === 0) {
                alert("No steps recorded to generate code from.");
                return;
            }

            // --- 3. Build the Prompt (adapted from your v1.0.0 logic) ---
            // Note: Login credentials are not in the v2 UI, so the login block is omitted.
            const prompt = `
You are an expert Cypress test automation engineer.
Generate a Cypress test script based ONLY on the user actions in the JSON array.

**Instructions:**
1. Create a standard Cypress structure: \`describe('User Recorded Flow', () => { ... });\`
2. Inside the describe block, create an \`it('should perform the recorded actions', () => { ... });\` block.
3. Inside the \`it\` block, convert each object from the 'steps' array into a corresponding Cypress command.

- For the VERY FIRST step (index 0): ALWAYS start with \`cy.visit(steps[0].url);\`. Then generate the command for that first step's action.
- For a 'click' action: use \`cy.get("selector").click();\` or another appropriate selector strategy.
- For an 'input' action: use \`cy.get("selector").type("value");\`.
- For an 'inspect' action (assertion): use \`cy.get("selector").should('be.visible');\`.
- Use the 'label', 'textContent', or 'name' fields to make the code more readable with comments.

4. **IMPORTANT**: Output ONLY the JavaScript code for the test script, wrapped in \`\`\`javascript ... \`\`\`. Do not include any other explanatory text.

**User Actions JSON Array:**
const steps = ${JSON.stringify(steps, null, 2)};
`;

            // --- 4. Prepare the API Request ---
            const requestBody = {
                messages: [
                    { role: "system", content: "You are a Cypress test automation expert who provides only code." },
                    { role: "user", content: prompt }
                ],
                max_tokens: 4096,
                temperature: 0.2, // Lower temperature for more deterministic code generation
                top_p: 0.95,
                frequency_penalty: 0,
                presence_penalty: 0,
            };

            // --- 5. Make the Fetch Call to Azure OpenAI ---
            const response = await fetch(fullUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': apiKey
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API Error (${response.status}): ${errorData.error.message}`);
            }

            const data = await response.json();
            
            if (!data.choices || data.choices.length === 0) {
                throw new Error("API returned no choices. Please check your Azure deployment.");
            }

            let generatedCode = data.choices[0].message.content;

            // --- 6. Clean and Copy the Code ---
            // Remove markdown formatting from the response
            generatedCode = generatedCode.replace(/^```(?:javascript)?\s*|```\s*$/g, '').trim();

            await navigator.clipboard.writeText(generatedCode);
            alert("Cypress code generated and copied to clipboard!");

        } catch (error) {
            console.error("Error generating or copying code:", error);
            alert(`An error occurred: ${error.message}`);
        }
    }
    
    async function handleDeleteStep(event) {
        const indexToDelete = parseInt(event.currentTarget.dataset.index, 10);
        if (isNaN(indexToDelete)) return;
        
        const { [STEPS_STORAGE_KEY]: steps } = await chrome.storage.local.get(STEPS_STORAGE_KEY);
        if (steps && Array.isArray(steps)) {
            steps.splice(indexToDelete, 1);
            await chrome.storage.local.set({ [STEPS_STORAGE_KEY]: steps });
        }
    }

     async function handleAddTimeAssertion(event) {
        const button = event.currentTarget;
        const loadTimeAssertValue = button.dataset.loadTime;
        const stepIndex = parseInt(button.dataset.index, 10); // <-- Get the index of the step

        if (!loadTimeAssertValue || isNaN(stepIndex)) return;

        const timeAssertionStep = {
            action: 'assert',
            assertionType: 'pageLoadTime',
            expectedValue: parseInt(loadTimeAssertValue, 10),
            label: `Assert page load time`,
            timestamp: Date.now()
        };
        
        // This button should disappear after being clicked.
        // We find the specific step by its index and remove the property.
        const { recordedSteps } = await chrome.storage.local.get('recordedSteps');
        if (recordedSteps && recordedSteps[stepIndex]) {
            delete recordedSteps[stepIndex].pageLoadTime;
            await chrome.storage.local.set({ recordedSteps: recordedSteps });
        }
        
        // Add the new assertion step to the list
        await addStepsToStorage([timeAssertionStep]);
    }
    function getRoundedLoadTime(ms) {
        if (ms <= 1000) return 1000;
        if (ms <= 1500) return 1500;
        if (ms <= 2000) return 2000;
        if (ms <= 3000) return 3000;
        return Math.ceil(ms / 1000) * 1000; // Round up to the nearest second for longer times
    }


     async function displayRecordedActions() {
        const { [STEPS_STORAGE_KEY]: steps } = await chrome.storage.local.get(STEPS_STORAGE_KEY);
        stepsListDiv.innerHTML = ''; 

        if (!steps || steps.length === 0) {
            stepsListDiv.classList.add('empty');
            stepsListDiv.textContent = 'Your recorded steps will appear here.';
            return;
        }

        stepsListDiv.classList.remove('empty');
        steps.forEach((step, index) => {
            const stepElement = document.createElement('div');
            stepElement.className = 'step-item';

            const textSpan = document.createElement('span');
            textSpan.className = 'step-item-text';
            textSpan.textContent = getStepDescription(step);

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'step-actions';

            const deleteBtn = document.createElement('img');
            deleteBtn.src = 'icons/delete.svg';
            deleteBtn.className = 'delete-step-btn';
            deleteBtn.dataset.index = index;
            deleteBtn.title = 'Delete this step';
            deleteBtn.addEventListener('click', handleDeleteStep);
            
            actionsDiv.appendChild(deleteBtn);

            // In the time button creation code:
            if (step.pageLoadTime) {
                const roundedTime = getRoundedLoadTime(step.pageLoadTime);
                const timeBtn = document.createElement('button');
                timeBtn.className = 'time-check-expand-btn';
                timeBtn.title = `Add assertion for page load time: < ${roundedTime}ms`;
                timeBtn.dataset.loadTime = roundedTime;
                timeBtn.dataset.index = index;
                
                // Ensure the button content is properly set
                timeBtn.innerHTML = `
                    <img src="icons/time.svg" alt="Time Check">
                    <span>Add time check &lt; ${roundedTime}ms</span>
                `;
                
                // Make sure the click handler is properly bound
                timeBtn.addEventListener('click', handleAddTimeAssertion);
                actionsDiv.appendChild(timeBtn);
            }
            
            stepElement.appendChild(textSpan);
            stepElement.appendChild(actionsDiv);
            stepsListDiv.appendChild(stepElement);
        });

        stepsListContainer.scrollTop = stepsListContainer.scrollHeight;
    }

    // --- In sidepanel.js, replace the getStepDescription function ---

    function getStepDescription(step) {
        let description = '';

        if (step.action === 'assert') {
            switch(step.assertionType) {
                // ADD THIS NEW CASE
                case 'pageLoadTime': 
                    return `Assert page load time is less than ${step.expectedValue}ms`;
                case 'exists': description = `Assert element exists`; break;
                // ... (your other assertion cases)
                default: description = `Assert on ${step.label}`;
            }
        } else {
             switch (step.action) {
                case 'visit': description = `Visit ${step.url}`; break;
                case 'click': 
                    description = `Click element with text '${step.textContent || step.label}'`; 
                    // Add the load time text if it exists
                    if (step.pageLoadTime) {
                        description += ` (Loaded in ${Math.round(step.pageLoadTime)}ms)`;
                    }
                    break;
                case 'input': description = `Type '${step.value}' into ${step.name || 'input field'}`; break;
                case 'visualAssert': description = `Visual Assert on image: '${step.snapshotName}'`; break;
                default: description = `${step.action} on ${step.label}`;
            }
        }
        return description;
    }
    
    // Configuration management functions
    async function saveConfigValue(key, value) {
        const storageKey = CONFIG_KEYS[key];
        if (storageKey) {
            await chrome.storage.local.set({ [storageKey]: value });
        }
    }
    
    async function loadConfigValues() {
        const configData = await chrome.storage.local.get(Object.values(CONFIG_KEYS));
        
        loginUrlInput.value = configData[CONFIG_KEYS.loginUrl] || '';
        testUsernameInput.value = configData[CONFIG_KEYS.testUsername] || '';
        testPasswordInput.value = configData[CONFIG_KEYS.testPassword] || '';
        testOtpInput.value = configData[CONFIG_KEYS.testOtp] || '';
    }
    
    // --- Initial State Setup ---
    function initialize() {
        showPage('page-one-start'); // Always start on the first page
        loadConfigValues(); // Load saved configuration
        chrome.storage.local.get('isRecording', (res) => {
            if(res.isRecording) {
                // If the extension was closed while recording, open on the recording page
                showPage('page-two-recording');
                displayRecordedActions();
            }
        });
    }

    initialize();
});

console.log("Guide2Cypress sidepanel script loaded (v2.0.0).");