import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as server from './server';
import * as testRunner from './testRunner'; 
import fetch from 'node-fetch'; 
import * as visualAssertionManager from './visualAssertionManager';
import { ChildProcess } from 'child_process';
let activeTestProcess: ChildProcess | null = null;

// This class manages the Webview Panel's state and communication.
class G2CPanel {
    public static currentPanel: G2CPanel | undefined;
    private readonly _panel: vscode.WebviewView;
    private _disposables: vscode.Disposable[] = [];
    private _extensionUri: vscode.Uri;

    public constructor(panel: vscode.WebviewView, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'src', 'webview')]
        };
        
        this._panel.webview.html = this._getHtmlForWebview();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'getViewState':
                        this.updateView();
                        return;
                    case 'startListener':
                        vscode.commands.executeCommand('guide2cypress.startListener');
                        return;
                    case 'stopListener':
                        vscode.commands.executeCommand('guide2cypress.stopListener');
                        return;
                    case 'runTest': // Handle the "Run Test" message from the webview
                        vscode.commands.executeCommand('guide2cypress.runTest', message);
                        return;
                    case 'generateA11yReport':
                        vscode.commands.executeCommand('guide2cypress.generateA11yReport');
                        return;
                    case 'healTest':
                        vscode.commands.executeCommand('guide2cypress.healTest');
                        return;
                    case 'cancelTestRun':
                        vscode.commands.executeCommand('guide2cypress.cancelTestRun');
                        return;
                    case 'resetToListener':
                        vscode.commands.executeCommand('guide2cypress.resetToListener');
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public dispose() {
        G2CPanel.currentPanel = undefined;
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    public updateView() {
        const state = getExtensionState();
        this._panel.webview.postMessage({ command: 'updateView', state });
    }

    private _getHtmlForWebview() {
        const webviewHtmlPath = vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'main.html');
        try {
            return fs.readFileSync(webviewHtmlPath.fsPath, 'utf8');
        } catch (error) {
            console.error('Error reading webview HTML file:', error);
            return `<h2>Error: Could not load the UI.</h2>`;
        }
    }
}

// --- Main Extension Logic ---
interface ExtensionState {
    isCypressProject: boolean;
    isListening: boolean;
    isProcessing: boolean;
    isReadyForAction: boolean;
    isRunningTest: boolean;
    lastGeneratedTestPath?: string;
    projectRootPath?: vscode.Uri; 
    e2eFolderPath?: vscode.Uri;
    lastAccessibilityReport?: any[];
    testResult?: 'success' | 'failure';
    lastRunErrorLog?: string;
    lastRunSteps?: any[];
    testingFramework: 'cypress' | 'playwright';
}
let extensionState: ExtensionState = { 
    isCypressProject: false,
    isListening: false,
    isProcessing: false,
    isReadyForAction: false,
    isRunningTest: false,
    testingFramework: 'playwright'
};
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    console.log('[Guide2Cypress] Extension is activating...');
    
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);

    const provider = new G2CPanelViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("guide2cypress.panel", provider)
    );
    
    // --- COMMAND REGISTRATION ---
    context.subscriptions.push(vscode.commands.registerCommand('guide2cypress.startListener', () => {
        if (!extensionState.isCypressProject) { return; }
        server.startServer();
        extensionState.isListening = true;
        extensionState.isReadyForAction = false;
        extensionState.testResult = undefined;
        updateUI();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('guide2cypress.stopListener', () => {
        server.stopServer();
        extensionState.isListening = false;
        updateUI();
    }));
    
   // In extension.ts

context.subscriptions.push(vscode.commands.registerCommand('guide2cypress.runTest', async (args) => {
    // Type guard to handle different ways the command can be called
    const filePath = typeof args === 'string' ? args : args?.filePath;
    const browser = typeof args === 'string' ? 'chromium' : args?.browser || 'chromium'; // Default to chromium

    if (!extensionState.projectRootPath) {
        vscode.window.showErrorMessage("Could not determine the project root.");
        return;
    }
    const testPath = filePath || extensionState.lastGeneratedTestPath;
    if (!testPath) {
        vscode.window.showErrorMessage("No test file path is available to run.");
        return;
    }

    // --- THIS IS THE CRITICAL FIX ---
    // 1. SET THE "RUNNING" STATE *BEFORE* AWAITING ANYTHING
    extensionState.isRunningTest = true;
    extensionState.testResult = undefined; // Clear the previous result
    updateUI(); // Immediately update the webview to show the loader and cancel button

    try {
        // 2. NOW, AWAIT THE TEST RUN
        const { exitCode, logs } = await testRunner.runTest(
            testPath,
            extensionState.projectRootPath,
            extensionState.testingFramework,
            browser,
            (process) => {
                activeTestProcess = process;
            }
        );

        // 3. SET THE FINAL STATE BASED ON THE RESULT
        if (exitCode === 0) {
            extensionState.testResult = 'success';
        } else {
            extensionState.testResult = 'failure';
            extensionState.lastRunErrorLog = logs;
        }

    } catch (error: any) {
        // Handle cases where the process itself fails to start
        extensionState.testResult = 'failure';
        extensionState.lastRunErrorLog = error.message;
        vscode.window.showErrorMessage(`Failed to run test: ${error.message}`);
    } finally {
        // 4. CLEAN UP AND UPDATE THE UI
        activeTestProcess = null;
        extensionState.isRunningTest = false;
        updateUI(); // Update the webview to show the final Pass/Fail screen
    }
}));
context.subscriptions.push(vscode.commands.registerCommand('guide2cypress.cancelTestRun', () => {
    if (activeTestProcess) {
        console.log('[Cancel] User requested to cancel the test run. Terminating process...');
        // Forcefully kill the process. 'SIGTERM' is a standard termination signal.
        activeTestProcess.kill('SIGTERM'); 
        activeTestProcess = null; // Clear the reference

        // Update the UI to show it's no longer running
        extensionState.isRunningTest = false;
        // Optionally, you can set a special "cancelled" result state
        extensionState.testResult = 'failure'; // Treat cancellation as a failure
        updateUI();
        
        vscode.window.showWarningMessage("Test run cancelled by user.");
    }
}));
context.subscriptions.push(vscode.commands.registerCommand('guide2cypress.resetToListener', () => {
// Reset the state to the "Ready to Listen" state, but immediately start listening.
extensionState.isReadyForAction = false;
extensionState.isRunningTest = false;
extensionState.testResult = undefined;
extensionState.lastGeneratedTestPath = undefined;
extensionState.lastRunErrorLog = undefined;
extensionState.lastRunSteps = undefined;
extensionState.lastAccessibilityReport = undefined;
// This effectively combines the "reset" and "start listener" actions
vscode.commands.executeCommand('guide2cypress.startListener');

vscode.window.showInformationMessage("Listener restarted. Ready for a new test from Chrome.");
}));
    context.subscriptions.push(vscode.commands.registerCommand('guide2cypress.openProjectFolder', () => {
        vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Select Cypress Project Folder'
        }).then(folderUris => {
            if (folderUris && folderUris[0]) {
                const existingFolders = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0;
                vscode.workspace.updateWorkspaceFolders(0, existingFolders, { uri: folderUris[0] });
            }
        });
    }));
    // 1. Command to orchestrate the report generation
context.subscriptions.push(vscode.commands.registerCommand('guide2cypress.generateA11yReport', async () => {
    if (!extensionState.lastAccessibilityReport || extensionState.lastAccessibilityReport.length === 0) {
        vscode.window.showInformationMessage("No accessibility violations were found to report.");
        return;
    }
    if (!extensionState.projectRootPath) {
        vscode.window.showErrorMessage("Cannot save report: Project root not found.");
        return;
    }

    vscode.window.showInformationMessage("🤖 Generating accessibility report with AI...");

    try {
        const markdownReport = await generateA11yReportFromAI(extensionState.lastAccessibilityReport);
        await saveMarkdownReport(markdownReport, extensionState.projectRootPath);
        vscode.window.showInformationMessage("✅ Accessibility report saved successfully!");
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to generate accessibility report: ${error.message}`);
    }
}));
// --- In src/extension.ts, REPLACE the guide2cypress.healTest command registration ---
    context.subscriptions.push(vscode.commands.registerCommand('guide2cypress.healTest', async () => {
        if (!extensionState.lastRunErrorLog || !extensionState.lastRunSteps) {
            vscode.window.showWarningMessage("No recent test failure data found to heal.");
            return;
        }

        vscode.window.showInformationMessage("💡 Analyzing failure... Asking AI for a suggestion.");

        try {
            const suggestion = await getHealSuggestionFromAI(
                extensionState.lastRunErrorLog,
                extensionState.lastRunSteps
            );

            const copyAction = "Copy Suggestion";
            const result = await vscode.window.showInformationMessage(
                `AI Suggestion: ${suggestion}`,
                { modal: true }, // Modal makes the message box stay until clicked
                copyAction
            );

            if (result === copyAction) {
                await vscode.env.clipboard.writeText(suggestion);
                vscode.window.showInformationMessage("Suggestion copied to clipboard!");
            }

        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to get healing suggestion: ${error.message}`);
        }
    }));


    // --- HANDOFF EVENT LISTENER ---
    // --- Find and modify the handoffReceived listener ---
    server.eventEmitter.on('handoffReceived', async (data) => {
        console.log('[Extension] Handoff data received!');
        vscode.window.showInformationMessage('G2C: Received data, processing files...');
        
        extensionState.isListening = false;
        extensionState.isProcessing = true;
        updateUI();
        server.stopServer();

        try {
            // **MODIFICATION**: Check for the new paths from the state
            extensionState.lastRunSteps = data.steps || [];
            extensionState.lastAccessibilityReport = data.accessibilityReport || [];
            if (!extensionState.projectRootPath) {
            throw new Error("Could not determine the project's root folder. Please re-open your project.");
        }
            extensionState.lastAccessibilityReport = data.accessibilityReport || [];
            if (data.steps && data.steps.length > 0) {
                // 1. The AI function now returns an object with both pieces of data.
                const { fileName, code } = await generateTestCodeFromAI(data.steps, extensionState.testingFramework);
                
                // 2. We pass the separate 'code' and 'fileName' to the save function.
            const savedFilePath = await saveTestFile(code, fileName, extensionState.projectRootPath, extensionState.testingFramework);
            extensionState.lastGeneratedTestPath = savedFilePath; 

            if (extensionState.testingFramework === 'playwright') {
        for (const step of data.steps) {
            if (step.action === 'visualAssert') {
                // Call the new, simplified function.
                // We pass the path of the file we just created.
                await visualAssertionManager.saveVisualBaseline(step, savedFilePath);
                vscode.window.showInformationMessage(`✅ Baseline saved for '${step.snapshotName}'.`);
            }
        }
    } 
            } else {
                vscode.window.showWarningMessage("No steps were recorded. Nothing to generate.");
            }
            
            
            extensionState.isProcessing = false;
            extensionState.isReadyForAction = true;
            updateUI();
            vscode.window.showInformationMessage('G2C: Test file generated successfully!');

        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to process test data: ${error.message}`);
            extensionState.isProcessing = false;
            extensionState.isReadyForAction = false;
            updateUI();
        }
    });

    checkCypressProject();
    vscode.workspace.onDidChangeWorkspaceFolders(() => checkCypressProject());
    
    console.log('[Guide2Cypress] Extension activation complete.');
}

// --- HELPER FUNCTIONS ---

// --- In src/extension.ts, ADD THIS NEW FUNCTION ---

async function getHealSuggestionFromAI(errorLog: string, steps: any[]): Promise<string> {
    console.log('[AI Heal] Starting test healing suggestion...');

    const endpoint = "https://omar-mcxhejf5-eastus2.cognitiveservices.azure.com/";
    const deployment = "model-router";
    const apiKey = "YOUR_AZURE_API_KEY_HERE"; // <-- IMPORTANT: PASTE YOUR API KEY HERE
    const apiVersion = "2024-05-01-preview";
    const fullUrl = `${endpoint}openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
    
    

    const prompt = `
You are an expert Senior QA Automation Engineer specializing in Cypress. Your task is to fix a broken test selector.

**Context:**
A Cypress test failed with a "Timed out retrying" error. I will provide you with the full error log and the complete JSON array of recorded steps from the original test session. The JSON contains valuable information, including HTML snapshots of the elements as they appeared during the recording.

**Your Mission:**
1.  **Analyze the Error:** Read the error log to identify the exact broken selector (e.g., \`cy.get('.old-button')\`).
2.  **Find the Failed Step:** Scan the provided JSON array to find the specific step object that corresponds to the failed command.
3.  **Analyze the Snapshot:** Look at the \`snapshot\` property within that failed step object. This is the original, correct HTML. Also, look at the \`textContent\` and \`label\` properties.
4.  **Provide a Fix:** Based on the snapshot and text content, suggest a new, more robust Cypress command to replace the broken one. **You MUST prioritize using \`cy.contains()\` if the element has clear text, as it is more resilient to changes.** If not, suggest a better CSS or XPath selector.
5.  **Explain Your Reasoning:** Briefly explain WHY the old selector failed (if possible) and WHY your new one is better.

**CRITICAL OUTPUT FORMAT:**
Your entire response must be a single line of text.
**Format:** \`[Your Suggested Code] --- [Your Brief Explanation]\`
**Example:** \`cy.contains('button', 'Sign In').click({ force: true }) --- The old class-based selector was fragile. Using cy.contains with the button's visible text 'Sign In' is much more stable.\`

**--- FAILED TEST ERROR LOG ---**
${errorLog}

**--- ORIGINALLY RECORDED STEPS JSON ---**
${JSON.stringify(steps, null, 2)}
`;

    const requestBody = {
        messages: [
            { role: "system", content: "You are a Cypress test automation expert who provides debugging suggestions." },
            { role: "user", content: prompt }
        ],
        max_tokens: 1024,
        temperature: 0.2,
        top_p: 0.95,
    };

    const response = await fetch(fullUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Azure API Error (${response.status}): ${errorData.error.message}`);
    }

    const data: any = await response.json();
    if (!data.choices || data.choices.length === 0 || !data.choices[0].message?.content) {
        throw new Error("AI returned an invalid response for the healing suggestion.");
    }

    console.log('[AI Heal] ✅ Suggestion received.');
    return data.choices[0].message.content;
}

// --- REPLACE the saveVisualBaselines function ---
async function saveVisualBaselines(steps: any[], projectRootUri: vscode.Uri): Promise<void> {
    const visualSteps = steps.filter(step => step.action === 'visualAssert');
    if (visualSteps.length === 0) { return; }

    // Snapshots are relative to the true project root
    const baselineDir = vscode.Uri.joinPath(projectRootUri, 'cypress', 'snapshots', 'baselines');
    await vscode.workspace.fs.createDirectory(baselineDir);

    for (const step of visualSteps) {
        if (!step.snapshotName || !step.snapshotData_base64) continue;
        const filePath = vscode.Uri.joinPath(baselineDir, `${step.snapshotName}.png`);
        const base64Data = step.snapshotData_base64.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        await vscode.workspace.fs.writeFile(filePath, new Uint8Array(buffer));
        console.log(`[Processing] ✅ Saved baseline: ${filePath.fsPath}`);
    }
}

async function saveCypressTestFile(code: string, fileName: string, e2eFolderUri: vscode.Uri): Promise<string> {
    // THE FIX: Use the 'fileName' provided by the AI instead of generating a new one.
    const filePath = vscode.Uri.joinPath(e2eFolderUri, fileName);

    const contentBuffer = Buffer.from(code, 'utf8');
    await vscode.workspace.fs.writeFile(filePath, new Uint8Array(contentBuffer));
    console.log(`[Processing] ✅ Saved Cypress test file: ${filePath.fsPath}`);
    
    // Open the newly created file for the user to see.
    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document);
    
    return filePath.fsPath;
}



// --- In src/extension.ts, REPLACE the generateA11yReportFromAI function ---

async function generateA11yReportFromAI(reportJson: any[]): Promise<string> {
    const endpoint = "https://omar-mcxhejf5-eastus2.cognitiveservices.azure.com/";
    const deployment = "model-router";
    const apiKey = "YOUR_AZURE_API_KEY_HERE"; // <-- IMPORTANT: PASTE YOUR API KEY HERE
    const apiVersion = "2024-12-01-preview";
    const fullUrl = `${endpoint}openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

    // A slightly simplified and more direct prompt
    const prompt = `
You are an accessibility expert. Your task is to convert the following technical JSON from an axe-core scan into a human-readable Markdown report.

**Report Requirements:**
-   Start with a high-level summary.
-   Group all instances of the same violation under a single heading.
-   For each violation type, explain the issue, its impact on users (especially screen reader users), and a clear "How to Fix" suggestion.
-   List the specific URLs and element selectors where each violation was found.
-   **CRITICAL:** Your entire response must be ONLY the Markdown report. Do not include any conversational text or introductions.

**Technical Axe-Core JSON:**
${JSON.stringify(reportJson, null, 2)}
`;

    const requestBody = {
        messages: [{ role: "system", content: "You are an accessibility expert who generates clean Markdown reports." }, { role: "user", content: prompt }],
        max_tokens: 4096,
        temperature: 0.3,
    };

    const response = await fetch(fullUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Azure API Error (${response.status}): ${errorData.error.message}`);
    }

    const data: any = await response.json();
    
    // **NEW, MORE ROBUST PARSING**
    if (!data.choices || data.choices.length === 0 || !data.choices.message?.content) {
        console.error("[AI Report Error] Invalid response structure:", data);
        throw new Error("AI returned an unexpected response structure. Check the Debug Console.");
    }

    let reportContent = data.choices.message.content;

    // Aggressively look for a markdown block and extract its content.
    const markdownBlockMatch = reportContent.match(/```(?:markdown|md)?\s*([\s\S]*?)\s*```/);
    if (markdownBlockMatch) {
        // If we found a markdown block, use what's inside it.
        reportContent = markdownBlockMatch;
    }
    
    // Final trim to remove any leading/trailing whitespace.
    reportContent = reportContent.trim();
    
    if (!reportContent) {
        throw new Error("AI response was received, but no report content could be extracted.");
    }
    
    return reportContent;
}

// 3. The function to save the final .md file
async function saveMarkdownReport(content: string, projectRootUri: vscode.Uri): Promise<void> {
    const reportDir = vscode.Uri.joinPath(projectRootUri, 'reports');
    await vscode.workspace.fs.createDirectory(reportDir); // Ensure the directory exists

    const date = new Date().toISOString().split('T')[0]; // Format as YYYY-MM-DD
    const fileName = `Accessibility-Audit-${date}.md`;
    const filePath = vscode.Uri.joinPath(reportDir, fileName);

    const contentBuffer = Buffer.from(content, 'utf8');
    await vscode.workspace.fs.writeFile(filePath, new Uint8Array(contentBuffer));
    
    // Open the report for the user
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(filePath));
}

// --- In src/extension.ts, REPLACE the generateCypressCodeFromAI function ---

async function generateTestCodeFromAI(steps: any[], framework: 'cypress' | 'playwright'): Promise<{ fileName: string, code: string }> {
    console.log(`[AI] Starting ${framework} code generation...`);
    
    // --- 1. Azure OpenAI API Configuration ---
    // In a real extension, you would get this from VS Code settings.
    // For now, we will hardcode it as you did in the Chrome extension.
    const endpoint = "https://omar-mcxhejf5-eastus2.cognitiveservices.azure.com/";
    const deployment = "model-router";
    const apiKey = "YOUR_AZURE_API_KEY_HERE"; // <-- IMPORTANT: PASTE YOUR API KEY HERE
    const apiVersion = "2024-05-01-preview";
    const fullUrl = `${endpoint}openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

    if (!steps || steps.length === 0) {
        console.log('[AI] No steps provided for generation.');
        throw new Error("No steps were provided to generate a test from.");
    }

    let prompt: string;
    if (framework === 'playwright') {
        prompt = _getPlaywrightPrompt(steps);
    } else {
        prompt = _getCypressPrompt(steps);
    }

    // --- 3. Prepare and Send the API Request ---
    const requestBody = {
        messages: [
            { role: "system", content: `You are a ${framework} test automation expert who provides only ${framework} code.` },
            { role: "user", content: prompt }
        ],
        max_tokens: 4096,
        temperature: 0.2,
        top_p: 0.95,
    };

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
        throw new Error(`Azure API Error (${response.status}): ${errorData.error.message}`);
    }

    const data: any = await response.json();
    if (!data.choices || data.choices.length === 0 || !data.choices[0].message?.content) {
        throw new Error("API returned an unexpected response structure.");
    }
    
    const fullResponse = data.choices[0].message.content;

    // --- THIS IS THE CORRECTED PARSING LOGIC ---
    
    // 1. Find the filename from the first line.
    const fileNameMatch = fullResponse.match(/^fileName:\s*(.*\.(cy\.js|spec\.js))/i);
    const fileName = fileNameMatch ? fileNameMatch[1].trim() : `g2c-fallback-${Date.now()}.${framework === 'playwright' ? 'spec.js' : 'cy.js'}`;

    // 2. Isolate the code by taking everything *after* the first line break.
    const firstNewlineIndex = fullResponse.indexOf('\n');
    const generatedCode = firstNewlineIndex !== -1 
        ? fullResponse.substring(firstNewlineIndex + 1).trim()
        : fullResponse; // Fallback in case there's no newline

    if (!generatedCode) {
        throw new Error("AI response was received, but no code could be extracted from it.");
    }
    
    console.log(`[AI] ✅ Code generation successful. Filename: ${fileName}`);
    // 3. Return the object with both pieces of data.
    return { fileName, code: generatedCode };
}

function _getPlaywrightPrompt(steps: any[]): string {
    // Define the login credentials and OTP code.
    // In a real application, these would come from environment variables.
    const LOGIN_URL = 'https://uat.vue.app.unduit.com/login';
    const TEST_USERNAME = 'ahmad.liaqat@unduit.pk';
    const TEST_PASSWORD = 'Qwerty-1';
    const OTP_CODE = '786321';

    return`
You are 'CodePilot-PW', an expert AI Test Automation Architect. Your prime directive is to convert a JSON array of user actions into a production-perfect Playwright script. The script must be architected with maximum reusability and maintainability.

## Core Directives (Non-Negotiable)
1.  **Filename First:** The absolute first line MUST be \`fileName: descriptive-test-name.spec.js\`.
2.  **Code Only:** After the filename, you MUST provide ONLY raw, valid JavaScript code using modern \`import\` syntax.
3.  **No Conversation:** Do not include any introductions or markdown.

## The Unbreakable Law of Locators
This is your most important rule.
1.  **HIGHEST PRIORITY:** You MUST ALWAYS prioritize user-facing locators: \`page.getByRole\`, \`page.getByText\`, \`page.getByLabel\`, etc.
2.  **CRITICAL FOR STABILITY: Use Exact Matches.** When using \`getByRole\` or \`getByText\`, you MUST use the \`{ exact: true }\` option. This is not optional. It prevents flaky tests by ensuring you select the intended element and not a partial substring match. Example: \`page.getByRole('button', { name: 'Submit', exact: true })\`.
3.  **LAST RESORT:** You may only use \`page.locator()\` if no user-facing locator is possible.
4.  **FORBIDDEN:** You MUST REFUSE to generate brittle, path-based locators (\`div > span:nth-of-type(2)\`). This is a critical anti-pattern.

## Prime Architecture Directive: Data-Driven Helper Functions
1.  **Create Generic Helpers:** Analyze the user's journey for repeated flows. Refactor these into reusable \`async\` helper functions.
2.  **Refactor Your Own Functions:** After defining helper functions, you MUST analyze them for duplication. If two functions are nearly identical, refactor them into a single, more generic, parameterized function (e.g., \`async function addDeviceToCart(config)\`). A helper function should be "dumb" and receive all its data as arguments.

## Engineering Principles
*   **Adherence to Recorded Actions:** Faithfully translate the user's recorded steps. Do NOT add your own conditional logic that the user did not perform.
*   **Test Structure:** The main body of the \`test\` block should be a clean, readable story of the user's journey, calling the helper functions. The login sequence MUST be the first \`test.step\`.
*   **Intelligent Waits:** After actions causing navigation, you MUST assert that a key element on the new page is visible. You MUST NOT use static waits (\`page.waitForTimeout()\`).
*   **MANDATORY: Alternative Selectors:** You MUST include one commented-out \`xpath\` alternative on the next line for EVERY locator. This is not optional.

---
## Mandatory Login Sequence
(This sequence MUST be placed inside the first \`test.step('Login to Application', ...)\`)
\`\`\`javascript
await page.goto('${LOGIN_URL}');
await page.getByPlaceholder('name@example.com').fill('${TEST_USERNAME}');
await page.getByPlaceholder('Your password').fill('${TEST_PASSWORD}');
await page.getByRole('button', { name: 'Sign in', exact: true }).click();
await page.locator('.emailOtp > .q-card__section').click();
await page.getByRole('button', { name: 'Email me a code', exact: true }).click();
const otpCode = '${OTP_CODE}';
await page.locator('.otp-field-outer input').first().type(otpCode);
await page.waitForURL('**/dashboard');
await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
\`\`\`

---
**User Actions JSON Array to convert:**
${JSON.stringify(steps, null, 2)}
`;
}

function _getCypressPrompt(steps: any[]): string {
    const LOGIN_URL = 'https://uat.vue.app.unduit.com/login';
    const TEST_USERNAME = 'ahmad@requester.com'; // Replace with a real test username if desired
    const TEST_PASSWORD = 'Unduit1!';     // Replace with a real test password if desired
    const OTP_CODE = '786321';
    // --- 2. Build the Final, Production-Ready Prompt ---
    // This uses the advanced, modular 'it' block structure we designed.
    return `
You are an expert Cypress test automation engineer. Your mission is to convert a JSON array of user actions into a professional, robust, and human-readable Cypress test script.

**CRITICAL OUTPUT RULES:**

1.  **Filename First:** The absolute first line of your response MUST be the filename, formatted exactly like this: fileName: name-of-the-test.cy.js
2.  **Code Only:** After the filename line, your entire response MUST be ONLY raw, valid JavaScript code.
3.  **NO CONVERSATION:** Do not include any explanations, introductions, or markdown fences.

**CYPRESS CODE GENERATION RULES:**

1.  **Structure:**
    *   Start the code with \`/// <reference types="cypress-xpath" />\`.
    *   Create a single top-level \`describe\` block. **Crucially, it MUST include \`{ testIsolation: false }\`**. Example: \`describe('User Journey through Dashboard', { testIsolation: false }, () => { ... });\`
    *   Inside the \`describe\`, ALWAYS include the mandatory Login \`it\` block for login as specified below.
    *   Analyze the user actions in the JSON and group them into logical \`it()\` blocks.

2.  **\`it\` Block (MANDATORY):**
    *   This block must run before every \`it\` test to ensure a logged-in state.
    *   \`cy.visit('${LOGIN_URL}');\`
    *   \`cy.get('input[type="text"]').clear().type('${TEST_USERNAME}');\`
    *   \`cy.get('input[type="password"]').clear().type('${TEST_PASSWORD}');\`
    *   \`cy.contains('button', 'Sign in').click();\`
    *   // OTP Sequence
    *   \`cy.get('.emailOtp > .q-card__section', { timeout: 15000 }).should('be.visible').click();\`
    *   \`cy.get('.q-btn--standard > .q-btn__content').first().click();\`
    *   \`const otpCode = '${OTP_CODE}';\`
    *   \`cy.get('.otp-field-outer input').each(($el, index) => { cy.wrap($el).type(otpCode[index]); });\`
    *   \`cy.wait(10000);\`
    *   \`cy.url().should('not.include', '/login');\`

3.  **\`it\` Blocks (The User Flow):**
    *   Create separate \`it()\` blocks for each logical task.
    *   **The VERY FIRST \`it\` block** must handle the initial navigation after login. It should be titled something like 'should navigate to the dashboard and wait for page to load'. It MUST contain \`cy.visit(...)\` using the URL from the first step, a \`cy.url().should(...)\` to verify, and a **mandatory \`cy.wait(10000);\`** to ensure the page is fully interactive.
    *   For **ALL SUBSEQUENT \`it\` blocks**, generate commands based on the action type:
        *   **Action \`click\`:**
            *   If the step's \`selectorStrategy\` is 'path' and it has \`textContent\`, use \`cy.contains()\`. Example: \`cy.contains('button', 'Submit').click({ force: true });\`
            *   Otherwise, use \`cy.get()\`. Example: \`cy.get('[data-testid="submit-btn"]').click({ force: true });\`
        *   **Action \`input\`:**
            *   Use \`cy.get()\` with the \`selector\`, then \`.clear().type()\`.
        *   **Action \`assert\`:**
            *   Generate the appropriate \`.should()\` command (e.g., 'be.visible', 'have.value').
        *   **Action \`visualAssert\`:**
        *   **CRITICAL:** For this action, you MUST use the \`cy.matchImageSnapshot()\` command.
        *   The argument to the command MUST be the \`snapshotName\` from the step data.
        *   You MUST include a comment above this command telling the user to install the \`cypress-image-snapshot\` plugin.
        *   **Example:**
            \`\`\`javascript
            // Requires 'cypress-image-snapshot' plugin to be installed and configured.
            cy.get('\${step.selector}').matchImageSnapshot('\${step.snapshotName}');
            \`\`\`

4.  **Alternative Selectors (MANDATORY):**
    *   For every generated command that interacts with an element (\`cy.get\`, \`cy.contains\`, \`cy.xpath\`), you need to include one commented-out alternative selector on the next line.
    *   Choose the best alternative from the step's \`xpath\` or other \`selector\` properties. 
    *   Example:
        \`\`\`javascript
        cy.get('#email').clear().type('user@example.com');
        // cy.xpath("//input[@id='email']").clear().type('user@example.com');
        \`\`\`
    *   If no clear alternative exists, do not show anything.

**User Actions JSON Array:**
${JSON.stringify(steps, null, 2)}
`;
}

// In extension.ts

async function saveTestFile(
    code: string, 
    fileName: string, 
    projectRootUri: vscode.Uri, // We now accept the projectRootUri directly
    framework: 'cypress' | 'playwright'
): Promise<string> {
    
    let testFolderUri: vscode.Uri;
    
    if (framework === 'playwright') {
        // For Playwright, the 'tests' directory is directly inside the project root.
        testFolderUri = vscode.Uri.joinPath(projectRootUri, 'tests');
    } else {
        // For Cypress, the 'e2e' directory is inside the 'cypress' folder.
        testFolderUri = vscode.Uri.joinPath(projectRootUri, 'cypress', 'e2e');
    }

    // Ensure the target directory exists before trying to write to it.
    await vscode.workspace.fs.createDirectory(testFolderUri);
    
    // Create the final file path.
    const filePath = vscode.Uri.joinPath(testFolderUri, fileName);

    // --- The rest of the function remains the same ---
    const contentBuffer = Buffer.from(code, 'utf8');
    await vscode.workspace.fs.writeFile(filePath, new Uint8Array(contentBuffer));
    console.log(`[Processing] ✅ Saved ${framework} test file: ${filePath.fsPath}`);
    
    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document);
    
    return filePath.fsPath;
}

// --- Comment out the old generateCypressCodeFromAI function for now ---
// This function is preserved but commented out as requested in the refactoring instructions
/*
async function generateCypressCodeFromAI(steps: any[]): Promise<{ fileName: string, code: string }> {
    // Original Cypress generation logic preserved but commented out
    // This can be restored if needed in the future
    return generateTestCodeFromAI(steps, 'cypress');
}
*/


// --- UI AND STATE MANAGEMENT FUNCTIONS ---

async function checkCypressProject() {
    console.log('[checkCypressProject] Starting intelligent project detection...');
    let isProject = false;
    let projectRoot: vscode.Uri | undefined;
    let e2eFolder: vscode.Uri | undefined;
    let detectedFramework: 'cypress' | 'playwright' = 'cypress';

    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        const workspaceRootUri = vscode.workspace.workspaceFolders[0].uri;
        const workspaceRootPath = workspaceRootUri.fsPath;
        
        console.log(`[checkCypressProject] Checking workspace: ${workspaceRootPath}`);
        
        // First, check for Playwright project
        const playwrightConfigPaths = [
            path.join(workspaceRootPath, 'playwright.config.ts'),
            path.join(workspaceRootPath, 'playwright.config.js'),
            path.join(workspaceRootPath, 'playwright.config.mjs')
        ];
        
        const playwrightConfigExists = playwrightConfigPaths.some(configPath => fs.existsSync(configPath));
        const testsDir = vscode.Uri.joinPath(workspaceRootUri, 'tests');
        
        if (playwrightConfigExists && fs.existsSync(testsDir.fsPath)) {
            isProject = true;
            projectRoot = workspaceRootUri;
            e2eFolder = testsDir;
            detectedFramework = 'playwright';
            console.log(`[checkCypressProject] ✅ Found Playwright project. Root: ${projectRoot.fsPath}`);
        }
        // Scenario 1: User opened a parent folder that CONTAINS `cypress/e2e`
        else {
            const standardE2ePath = vscode.Uri.joinPath(workspaceRootUri, 'cypress', 'e2e');
            if (fs.existsSync(standardE2ePath.fsPath)) {
                // Also check if there's a package.json with cypress dependency or node_modules with cypress
                const packageJsonPath = path.join(workspaceRootPath, 'package.json');
                const nodeModulesCypress = path.join(workspaceRootPath, 'node_modules', 'cypress');
                
                if (fs.existsSync(packageJsonPath) || fs.existsSync(nodeModulesCypress)) {
                    isProject = true;
                    projectRoot = workspaceRootUri; // The project root is the folder they opened
                    e2eFolder = standardE2ePath;
                    detectedFramework = 'cypress';
                    console.log(`[checkCypressProject] ✅ Found standard Cypress project. Root: ${projectRoot.fsPath}`);
                }
            } 
            // Scenario 2: User opened the `cypress` folder directly
            else if (path.basename(workspaceRootPath).toLowerCase() === 'cypress') {
            const directE2ePath = vscode.Uri.joinPath(workspaceRootUri, 'e2e');
            if (fs.existsSync(directE2ePath.fsPath)) {
                // The project root is the PARENT of the folder they opened
                const parentPath = path.dirname(workspaceRootPath);
                const packageJsonPath = path.join(parentPath, 'package.json');
                const nodeModulesCypress = path.join(parentPath, 'node_modules', 'cypress');
                
                if (fs.existsSync(packageJsonPath) || fs.existsSync(nodeModulesCypress)) {
                    isProject = true;
                    projectRoot = vscode.Uri.file(parentPath);
                    e2eFolder = directE2ePath;
                    console.log(`[checkCypressProject] ✅ Found direct 'cypress' folder open. Root: ${projectRoot.fsPath}`);
                }
            }
        }
        // Scenario 3: User opened the e2e folder directly
        else if (path.basename(workspaceRootPath).toLowerCase() === 'e2e') {
            // Check if parent is cypress and grandparent has package.json
            const parentPath = path.dirname(workspaceRootPath);
            if (path.basename(parentPath).toLowerCase() === 'cypress') {
                const grandParentPath = path.dirname(parentPath);
                const packageJsonPath = path.join(grandParentPath, 'package.json');
                const nodeModulesCypress = path.join(grandParentPath, 'node_modules', 'cypress');
                
                if (fs.existsSync(packageJsonPath) || fs.existsSync(nodeModulesCypress)) {
                    isProject = true;
                    projectRoot = vscode.Uri.file(grandParentPath);
                    e2eFolder = workspaceRootUri;
                    console.log(`[checkCypressProject] ✅ Found direct 'e2e' folder open. Root: ${projectRoot.fsPath}`);
                }
            }
        }
        }
        
        // Debug logging
        if (isProject) {
            console.log(`[checkCypressProject] Framework: ${detectedFramework}`);
            console.log(`[checkCypressProject] Project Root: ${projectRoot?.fsPath}`);
            console.log(`[checkCypressProject] E2E/Tests Folder: ${e2eFolder?.fsPath}`);
        } else {
            console.log(`[checkCypressProject] ❌ No Cypress or Playwright project detected`);
        }
    }
    
    // If the folder changes and it's no longer a Cypress project, stop listening.
    if (!isProject && extensionState.isListening) {
        vscode.commands.executeCommand('guide2cypress.stopListener');
    }

    // Update the global state with our findings
    extensionState.isCypressProject = isProject;
    extensionState.projectRootPath = projectRoot;
    extensionState.e2eFolderPath = e2eFolder;
    extensionState.testingFramework = detectedFramework;
    updateUI();
}
function updateUI() {
    console.log('[updateUI] Updating UI components with state:', extensionState);

    if (extensionState.testResult === 'success') {
        statusBarItem.text = `$(check-all) G2C: Test Passed`;
        statusBarItem.tooltip = "The last test run was successful. Click to open the panel.";
        statusBarItem.command = 'workbench.view.extension.guide2cypress-sidebar';
    } else if (extensionState.testResult === 'failure') {
        statusBarItem.text = `$(error) G2C: Test Failed`;
        statusBarItem.tooltip = "The last test run failed. Click to open the panel.";
        statusBarItem.command = 'workbench.view.extension.guide2cypress-sidebar';
    } else if (extensionState.isRunningTest) {
        statusBarItem.text = `$(sync~spin) G2C: Running Test...`;
        statusBarItem.tooltip = "A Cypress test is currently running.";
        statusBarItem.command = undefined;
    } else if (extensionState.isProcessing) {
        statusBarItem.text = `$(sync~spin) G2C: Processing...`;
        statusBarItem.tooltip = "Guide2Cypress is generating test files.";
        statusBarItem.command = undefined;
    } else if (extensionState.isReadyForAction) {
        statusBarItem.text = `$(pass) G2C: Test Ready`;
        statusBarItem.tooltip = "Your test file is ready. Click to open the panel.";
        statusBarItem.command = 'workbench.view.extension.guide2cypress-sidebar';
    } else if (extensionState.isListening) {
        statusBarItem.text = `$(broadcast) G2C Listener: Active`;
        statusBarItem.tooltip = "The listener is active. Click to stop.";
        statusBarItem.command = 'guide2cypress.stopListener';
    } else if (extensionState.isCypressProject) {
        statusBarItem.text = `$(check) G2C: Ready`;
        statusBarItem.tooltip = "Guide2Cypress is ready. Click to open the panel.";
        statusBarItem.command = 'workbench.view.extension.guide2cypress-sidebar';
    } else {
        statusBarItem.text = `$(error) G2C: Open Cypress Project`;
        statusBarItem.tooltip = "Click to select your Cypress project folder.";
        statusBarItem.command = 'guide2cypress.openProjectFolder';
    }
    statusBarItem.show();

    if (G2CPanel.currentPanel) {
        G2CPanel.currentPanel.updateView();
    }
}

function getExtensionState(): ExtensionState {
    return extensionState;
}

class G2CPanelViewProvider implements vscode.WebviewViewProvider {
    constructor(private readonly _extensionUri: vscode.Uri) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        G2CPanel.currentPanel = new G2CPanel(webviewView, this._extensionUri);
    }
}

export function deactivate() {
    server.stopServer();
}