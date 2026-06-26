// --- START OF FILE content.js ---

let recording = false;
const STEPS_STORAGE_KEY = 'recordedSteps';
let inspectionMode = 'assertion';

let isInspecting = false;
let highlightedElement = null;
const HIGHLIGHT_STYLE_ID = 'guide2cypress-inspector-style';
const HIGHLIGHT_CLASS = 'guide2cypress-highlight-border';

// Recording Inspector variables
let inspectorTooltip = null;
const INSPECTOR_STYLE_ID = 'g2c-inspector-style';
const RECORDING_HIGHLIGHT_CLASS = 'g2c-recording-highlight';

let lastClickedStepInfo = null;
let loaderObserver = null;
let loaderStartTime = null;
const LOADER_SELECTOR = 'div.loader-spinner';

let isPausedBySidePanel = false;

const highlightCSS = `
.${HIGHLIGHT_CLASS} {
  outline: 2px dashed #3B82F6 !important;
  outline-offset: 2px;
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.7) !important;
  cursor: crosshair !important;
  background-color: rgba(59, 130, 246, 0.1) !important;
}
`;

const inspectorCSS = `
  .${RECORDING_HIGHLIGHT_CLASS} {
    outline: 2px solid #3B82F6 !important; /* Use the brand's electric blue */
    outline-offset: 1px;
  }
  #g2c-recording-inspector-tooltip {
    position: fixed;
    background-color: #1D2939; /* Dark Gray from the theme */
    color: #FFFFFF;
    font-family: monospace;
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 4px;
    z-index: 9999999;
    pointer-events: none; /* Prevents the tooltip from interfering with mouse events */
    display: none; /* Hidden by default */
  }
`;

function getFullDomSnapshot() {
    return document.documentElement.outerHTML;
}

function getMinimalDOMSnapshot(element) {
    let currentElement = element;
    let snapshot = "";
    while (currentElement) {
        if (isMeaningful(currentElement)) {
            snapshot = currentElement.outerHTML || currentElement.innerHTML;
            break;
        }
        currentElement = currentElement.parentElement;
    }
    if (!snapshot) {
        snapshot = element.outerHTML || element.innerHTML;
    }
    return snapshot;
}

function isMeaningful(element) {
    if (!element) return false;
    const text = element.textContent?.trim();
    const hasLabel = text && text.length > 0;
    const hasUsefulAttr = ['alt', 'title', 'aria-label'].some(attr =>
        element.getAttribute?.(attr)
    );
    const isSemantic = ['BUTTON', 'A', 'LABEL'].includes(element.tagName);
    return hasLabel || hasUsefulAttr || isSemantic;
}

function getXPath(element) {
    if (!(element instanceof Element)) return null;
    if (element.tagName === 'BODY') return '/html/body';
    if (element.tagName === 'HTML') return '/html';
    if (element.id) {
        const selectorById = `//*[@id='${element.id}']`;
        try {
            const matches = document.evaluate(selectorById, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            if (matches.snapshotLength === 1 && matches.snapshotItem(0) === element) {
                return selectorById;
            }
        } catch (e) { /* Ignored */ }
    }
    if (element.className && typeof element.className === 'string' && element.className.trim()) {
        const classNames = element.className.trim().split(/\s+/);
        const classConditions = classNames.map(cn => `contains(concat(' ', normalize-space(@class), ' '), ' ${cn} ')`).join(' and ');
        const selectorByClass = `//${element.tagName.toLowerCase()}[${classConditions}]`;

        try {
            const matches = document.evaluate(selectorByClass, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            if (matches.snapshotLength > 0) {
                let count = 0;
                for (let i = 0; i < matches.snapshotLength; i++) {
                    if (matches.snapshotItem(i).tagName === element.tagName) {
                        count++;
                        if (matches.snapshotItem(i) === element) {
                            return matches.snapshotLength === 1 && count === 1 ? selectorByClass : `(${selectorByClass})[${count}]`;
                        }
                    }
                }
            }
        } catch (e) { /* Ignored */ }
    }
    if (element.textContent && element.textContent.trim()) {
        const text = element.textContent.trim().replace(/'/g, `\u2019`);
        const selectorByText = `//${element.tagName.toLowerCase()}[normalize-space(.)='${text}']`;
        try {
            const matches = document.evaluate(selectorByText, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            if (matches.snapshotLength === 1 && matches.snapshotItem(0) === element) {
                return selectorByText;
            }
            const selectorByTextContains = `//${element.tagName.toLowerCase()}[contains(normalize-space(.), '${text}')]`;
            const containsMatches = document.evaluate(selectorByTextContains, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            if(containsMatches.snapshotLength > 0){
                let count = 0;
                for(let i=0; i < containsMatches.snapshotLength; i++){
                    if(containsMatches.snapshotItem(i).tagName === element.tagName){
                        count++;
                        if(containsMatches.snapshotItem(i) === element){
                            return `(${selectorByTextContains})[${count}]`;
                        }
                    }
                }
            }

        } catch (e) { /* Ignored */ }
    }
    let ix = 0;
    const siblings = element.parentNode ? element.parentNode.childNodes : [];
    for (let i = 0; i < siblings.length; i++) {
        const sibling = siblings[i];
        if (sibling === element) {
            const parentPath = getXPath(element.parentNode);
            if (parentPath === '/html' && element.tagName === 'BODY') return '/html/body';
            return parentPath ? `${parentPath}/${element.tagName.toLowerCase()}[${ix + 1}]` : `/${element.tagName.toLowerCase()}[${ix+1}]`;
        }
        if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
            ix++;
        }
    }
    return null;
}


function createInspectorTooltip() {
    if (!inspectorTooltip) {
        inspectorTooltip = document.createElement('div');
        inspectorTooltip.id = 'g2c-recording-inspector-tooltip';
        document.body.appendChild(inspectorTooltip);
    }
}

function toggleInspectorStyle(enable) {
    let styleElement = document.getElementById(INSPECTOR_STYLE_ID);
    if (enable) {
        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = INSPECTOR_STYLE_ID;
            styleElement.textContent = inspectorCSS;
            (document.head || document.documentElement).appendChild(styleElement);
        }
    } else {
        if (styleElement) {
            styleElement.remove();
        }
    }
}

function toggleHighlightStyle(enable) {
    let styleElement = document.getElementById(HIGHLIGHT_STYLE_ID);
    if (enable) {
        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = HIGHLIGHT_STYLE_ID;
            styleElement.textContent = highlightCSS;
            (document.head || document.documentElement).appendChild(styleElement);
        }
    } else {
        if (styleElement) {
            styleElement.remove();
        }
        if (highlightedElement) {
            highlightedElement.classList.remove(HIGHLIGHT_CLASS);
            highlightedElement = null;
        }
    }
}


// --- In content.js, REPLACE the existing handleRecordingMouseOver function ---

function handleRecordingMouseOver(event) {
    if (!recording || isInspecting) { return; }
    
    const target = event.target;
    
    // Ignore body and html elements
    if (target.tagName === 'BODY' || target.tagName === 'HTML') {
        return;
    }
    const elementType = getElementType(target);    
    // Add the recording highlight
    target.classList.add(RECORDING_HIGHLIGHT_CLASS);
    
    // Update and position the tooltip
    if (inspectorTooltip) {
        // --- THIS IS THE FIX ---
        // Display the friendly element type in the tooltip
        inspectorTooltip.textContent = elementType || 'Element'; // Fallback to 'Element'
        // --- END OF FIX ---
        
        inspectorTooltip.style.display = 'block';
        
        // Calculate position
        const rect = target.getBoundingClientRect();
        const tooltipHeight = 20; // Approximate tooltip height
        
        // Position above the element by default
        let top = rect.top - tooltipHeight - 5;
        let left = rect.left;
        
        // If element is at the top of viewport, position below instead
        if (rect.top < tooltipHeight + 10) {
            top = rect.bottom + 5;
        }
        
        // Ensure tooltip doesn't go off screen horizontally
        const tooltipWidth = inspectorTooltip.offsetWidth;
        if (left + tooltipWidth > window.innerWidth) {
            left = window.innerWidth - tooltipWidth - 5;
        }
        if (left < 0) {
            left = 5;
        }
        
        inspectorTooltip.style.top = `${top + window.scrollY}px`;
        inspectorTooltip.style.left = `${left + window.scrollX}px`;
    }
}
function handleRecordingMouseOut(event) {
    // Remove the recording highlight
    event.target.classList.remove(RECORDING_HIGHLIGHT_CLASS);
    
    // Hide the tooltip
    if (inspectorTooltip) {
        inspectorTooltip.style.display = 'none';
    }
}

function handleInspectMouseOver(event) {
    if (!isInspecting) return;
    if (inspectionMode === 'visual' && event.target.tagName !== 'IMG') {
        if (highlightedElement) {
             highlightedElement.classList.remove(HIGHLIGHT_CLASS);
             highlightedElement = null;
        }
        return;
    }

    if (highlightedElement && highlightedElement !== event.target) {
        highlightedElement.classList.remove(HIGHLIGHT_CLASS);
    }
    highlightedElement = event.target;
    highlightedElement.classList.add(HIGHLIGHT_CLASS);
}

function getElementDetails(element) {
    const tagName = element.tagName.toLowerCase();
    let elementType = 'Generic'; // Default type
    let attributes = {
        innerText: element.innerText?.trim() || '',
        value: element.value || '',
        placeholder: element.getAttribute('placeholder') || '',
        href: element.getAttribute('href') || '',
        alt: element.getAttribute('alt') || '',
        className: element.className || '',
        id: element.id || '',
        // You could add computed styles here if needed in the future
        // color: window.getComputedStyle(element).color,
    };

    // Determine the specific element type for the side panel
    if (tagName === 'button' || (tagName === 'input' && ['submit', 'button', 'reset'].includes(element.type))) {
        elementType = 'Button';
    } else if (tagName === 'a') {
        elementType = 'Link';
    } else if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
        elementType = 'Input';
    } else if (tagName === 'img') {
        elementType = 'Image';
    } else if (attributes.innerText) {
        // If it's not interactive but has text, treat it as a Text element
        elementType = 'Text';
    }
    
    return { elementType, tagName, attributes };
}


async function handleInspectClick(event) {
    if (!isInspecting) return;
    
    // In visual mode, only allow clicks on images
    if (inspectionMode === 'visual' && event.target.tagName !== 'IMG') {
        return;
    }
    
    event.preventDefault();
    event.stopPropagation();
    
    const target = event.target;
    stopInspecting(); // Stop the visual highlight first

    

    if (inspectionMode === 'visual') {
        // --- Visual Assertion Capture ---
        html2canvas(target, { useCORS: true, backgroundColor: null }).then(canvas => {
            const imageDataUrl = canvas.toDataURL('image/png');
            // ---- ROBUST DEBUGGING ----
            // 1. Log the generated data URL to the console. If it's very short, it's blank.
            console.log("Generated html2canvas Data URL:", imageDataUrl); 
            
            // 2. Open the canvas result. This might be blank due to CORS.
            window.open(imageDataUrl, '_blank'); 
            
            // 3. IMPORTANT: Also open the original image source. This will ALWAYS work.
            // This proves your click handler is targeting the correct image.
            window.open(target.src, '_blank');
            // Generate a descriptive name for the snapshot
            const snapshotName = target.alt?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || `visual-snapshot-${Date.now()}`;
            
            chrome.runtime.sendMessage({
                type: 'INSPECTION_VISUAL_COMPLETE',
                selector: getCssSelector(target).selector,
                xpath: getXPath(target),
                snapshotName: snapshotName,
                snapshotData_base64: imageDataUrl
            });
        });
    } else {
        // --- Regular Assertion Flow (as before) ---
        const selectorInfo = getCssSelector(target);
        const xpathSelector = getXPath(target);

        if (!selectorInfo.selector && !xpathSelector) {
            chrome.runtime.sendMessage({ type: 'INSPECTION_FAILED' });
            return;
        }
    
        const elementDetails = getElementDetails(target);

        chrome.runtime.sendMessage({
            type: 'INSPECTION_COMPLETE',
            selector: selectorInfo.selector,
            xpath: xpathSelector,
            details: elementDetails
        });
    }
}

function startInspecting() {
    if (isInspecting) return;
    isInspecting = true;
    toggleHighlightStyle(true);
    document.addEventListener('mouseover', handleInspectMouseOver, true);
    document.addEventListener('click', handleInspectClick, true);
}

function stopInspecting() {
    if (!isInspecting) return;
    isInspecting = false;
    toggleHighlightStyle(false);
    document.removeEventListener('mouseover', handleInspectMouseOver, true);
    document.removeEventListener('click', handleInspectClick, true);
}

async function appendStepToStorage(newStep, bypassRecordingAndPauseCheck = false) {
    if (!bypassRecordingAndPauseCheck && (!recording || isInspecting || isPausedBySidePanel)) {
        return;
    }
    try {
        const result = await chrome.storage.local.get(STEPS_STORAGE_KEY);
        const currentSteps = result[STEPS_STORAGE_KEY] || [];
        newStep.locatorType = newStep.locatorType || 'css';
        currentSteps.push(newStep);
        await chrome.storage.local.set({ [STEPS_STORAGE_KEY]: currentSteps });
    } catch (error) {
        console.error("Error appending step to storage:", error);
    }
}

function isSelectorUnique(selector) {
    if (!selector) return false;
    try {
        return document.querySelectorAll(selector).length === 1;
    } catch (e) { return false; }
}

function isPotentiallyDynamic(value) {
    if (!value || typeof value !== 'string') return false;
    if (/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(value)) return true;
    if (value.length > 15 && /[a-zA-Z]/.test(value) && /[0-9]/.test(value) && /[-_]/.test(value)) return true;
    return false;
}

function getCssSelector(el) {
    if (!(el instanceof Element)) return { selector: null, strategy: 'invalidElement' };
    const options = {
        testAttributes: ['data-testid', 'data-cy', 'data-test-id', 'data-qa'],
        semanticAttributes: ['name', 'placeholder', 'aria-label', 'title', 'alt'],
        tagAttributeSelectors: { 'INPUT': ['type'], 'BUTTON': ['type'] }
    };
    let selector = null;
    let strategy = 'none';
    const tagName = el.tagName.toLowerCase();

    for (const attr of options.testAttributes) {
        const attrValue = el.getAttribute(attr);
        if (attrValue) {
            selector = `${tagName}[${attr}="${CSS.escape(attrValue)}"]`;
            if (isSelectorUnique(selector)) return { selector, strategy: `testAttribute (${attr})` };
        }
    }
    if (el.id && !isPotentiallyDynamic(el.id)) {
        const idSelector = `#${CSS.escape(el.id)}`;
        if (isSelectorUnique(idSelector)) return { selector: idSelector, strategy: 'stableId' };
    }
    for (const attr of options.semanticAttributes) {
        const attrValue = el.getAttribute(attr);
        if (attrValue) {
            selector = `${tagName}[${attr}="${CSS.escape(attrValue)}"]`;
            if (isSelectorUnique(selector)) return { selector, strategy: `semanticAttribute (${attr})` };
        }
    }
    
    const path = [];
    let currentEl = el;
    while (currentEl && currentEl.nodeType === Node.ELEMENT_NODE && currentEl.tagName.toLowerCase() !== 'html') {
        let selectorPart = currentEl.tagName.toLowerCase();
        const parent = currentEl.parentNode;
        if (parent && parent.nodeType === Node.ELEMENT_NODE) {
            let index = 1;
            let sibling = currentEl.previousElementSibling;
            while (sibling) {
                if (sibling.tagName === currentEl.tagName) index++;
                sibling = sibling.previousElementSibling;
            }
            if (index > 1 || (currentEl.nextElementSibling && currentEl.nextElementSibling.tagName === currentEl.tagName)) {
                 selectorPart += `:nth-of-type(${index})`;
            }
        }
        path.unshift(selectorPart);
        const currentPathSelector = path.join(' > ');
        if (isSelectorUnique(currentPathSelector)) {
            return { selector: currentPathSelector, strategy: 'path', snapshot: getMinimalDOMSnapshot(el) };
        }
        currentEl = parent;
    }
    
    const fullPath = path.join(' > ');
    return {
        selector: fullPath || null,
        strategy: 'path',
        snapshot: getMinimalDOMSnapshot(el)
    };
}

function recordClick(e) {
    if (!recording || isInspecting || isPausedBySidePanel) return;
    
    const target = e.target;
    const selectorInfo = getCssSelector(target);
    const xpathSelector = getXPath(target);
    if (!selectorInfo.selector && !xpathSelector) return;
    
    const label = target.innerText?.trim() || target.value?.trim() || target.getAttribute('aria-label') || target.name || target.placeholder || target.id || target.tagName;
    const textContent = target.innerText?.trim() || "";
    const tagName = target.tagName.toLowerCase();
    
    const stepData = {
        action: 'click',
        selector: selectorInfo.selector,
        selectorStrategy: selectorInfo.strategy,
        xpath: xpathSelector,
        label: label ? label.substring(0, 50) : '',
        textContent: textContent,
        tagName: tagName,
        timestamp: Date.now(), // Use a precise timestamp
        url: window.location.href,
        snapshot: selectorInfo.snapshot || ''
    };
    
    // "Remember" this click as the potential cause of a page load
    lastClickedStepInfo = { timestamp: stepData.timestamp };
    
    // Start watching for the loader to appear
    startLoaderObserver();
    
    appendStepToStorage(stepData);
}

function recordInput(e) {
    if (!recording || isInspecting || isPausedBySidePanel) return;

    const target = e.target;
    const targetTag = target.tagName.toUpperCase();
    const targetType = target.type ? target.type.toLowerCase() : '';
    const recordableInputTypes = ['text', 'password', 'email', 'number', 'search', 'tel', 'url', 'date', 'datetime-local', 'month', 'time', 'week', 'color'];
    
    if (targetTag !== 'TEXTAREA' && targetTag !== 'SELECT' && !(targetTag === 'INPUT' && recordableInputTypes.includes(targetType))) return;

    const selectorInfo = getCssSelector(target);
    const xpathSelector = getXPath(target);
    if ((!selectorInfo || !selectorInfo.selector) && !xpathSelector) return;

    const value = target.value;
    const name = target.name || target.placeholder || target.getAttribute('aria-label') || target.id || target.tagName;
    const tagName = target.tagName.toLowerCase();

    const stepData = {
        action: 'input',
        selector: selectorInfo ? selectorInfo.selector : null,
        selectorStrategy: selectorInfo ? selectorInfo.strategy : 'none',
        xpath: xpathSelector,
        value: value,
        name: name,
        tagName: tagName,
        timestamp: Date.now(),
        url: window.location.href,
        snapshot: (selectorInfo && selectorInfo.snapshot) ? selectorInfo.snapshot : ''
    };
    appendStepToStorage(stepData);
}

chrome.storage.local.get(['isRecording', 'isPaused'], (res) => {
    recording = res.isRecording || false;
    isPausedBySidePanel = (recording && res.isPaused) ? res.isPaused : false;
    stopInspecting();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'START_RECORDING':
            stopInspecting();
            recording = true;
            isPausedBySidePanel = false;
            
            // Initialize recording inspector
            createInspectorTooltip();
            toggleInspectorStyle(true);
            document.addEventListener('mouseover', handleRecordingMouseOver);
            document.addEventListener('mouseout', handleRecordingMouseOut);
            
            sendResponse({ status: 'success', message: 'Recording started' });
            break;
        case 'STOP_RECORDING':
            stopInspecting();
            recording = false;
            isPausedBySidePanel = false;
            
            // Clean up recording inspector
            toggleInspectorStyle(false);
            document.removeEventListener('mouseover', handleRecordingMouseOver);
            document.removeEventListener('mouseout', handleRecordingMouseOut);
            
            sendResponse({ status: 'success', message: 'Recording stopped' });
            break;
        case 'START_INSPECTING':
            isPausedBySidePanel = false;
            inspectionMode = message.mode || 'assertion';
            
            // Clean up recording inspector when starting inspection
            toggleInspectorStyle(false);
            document.removeEventListener('mouseover', handleRecordingMouseOver);
            document.removeEventListener('mouseout', handleRecordingMouseOut);
            
            startInspecting();
            sendResponse({ status: 'success', message: 'Inspection started' });
            break;
        case 'STOP_INSPECTING':
            stopInspecting();
            sendResponse({ status: 'success', message: 'Inspection stopped' });
            break;
        case 'PAUSE_RECORDING_CONTENT':
             if (recording && !isInspecting) {
                isPausedBySidePanel = true;
             }
            sendResponse({ status: 'success' });
            break;
        case 'RESUME_RECORDING_CONTENT':
            if (recording && !isInspecting) {
                isPausedBySidePanel = false;
            }
            sendResponse({ status: 'success' });
            break;
    }
    return true;
});

document.addEventListener('click', recordClick, true);
document.addEventListener('change', recordInput, true);

console.log("Guide2Cypress content script loaded (v2.0.0).");


async function loaderMutationCallback(mutationsList, observer) {
    const loaderElement = document.querySelector(LOADER_SELECTOR);

    // Case 1: The loader has APPEARED and we haven't started timing yet
    if (loaderElement && window.getComputedStyle(loaderElement).display !== 'none' && !loaderStartTime) {
        loaderStartTime = performance.now();
        console.log('Loader detected, timer started.');
    }
    // Case 2: The loader has DISAPPEARED and we *were* timing it
    else if (!loaderElement || (window.getComputedStyle(loaderElement).display === 'none' && loaderStartTime)) {
        const duration = performance.now() - loaderStartTime;
        console.log(`Loader disappeared. Duration: ${duration}ms`);

        // --- 1. Send Timing Data (existing logic) ---
        if (lastClickedStepInfo) {
            chrome.runtime.sendMessage({
                type: 'LOADER_TIME_CAPTURED',
                duration: duration,
                clickTimestamp: lastClickedStepInfo.timestamp
            }).catch(e => {}); // It's okay if the side panel is closed
        }

        // --- 2. Run Silent Accessibility Audit (NEW LOGIC) ---
        if (typeof axe !== 'undefined') {
            try {
                const results = await axe.run(); // Run the audit
                if (results.violations && results.violations.length > 0) {
                    // If violations are found, send them to the side panel
                    chrome.runtime.sendMessage({
                        type: 'AXE_AUDIT_COMPLETE',
                        audit: {
                            url: window.location.href, // Include URL for context
                            violations: results.violations
                        }
                    }).catch(e => {}); // Also okay if side panel is closed
                }
            } catch (err) {
                console.error('Guide2Cypress: Axe-core audit failed on this page.', err);
            }
        }
        // --- END OF NEW LOGIC ---

        // Clean up and stop observing to save performance
        observer.disconnect();
        loaderStartTime = null;
        lastClickedStepInfo = null;
        loaderObserver = null;
    }
}
// This function sets up and starts the observer
function startLoaderObserver() {
    // If we're already observing, don't start a new one
    if (loaderObserver) return;

    loaderStartTime = null; // Reset timer
    
    const config = { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] };
    loaderObserver = new MutationObserver(loaderMutationCallback);
    loaderObserver.observe(document.body, config);

    // Failsafe: if the loader doesn't appear after a few seconds, stop observing
    setTimeout(() => {
        if (loaderObserver) {
            loaderObserver.disconnect();
            loaderObserver = null;
        }
    }, 5000); // 5-second timeout
}
function getElementType(element) {
    if (!element) return '';

    const tagName = element.tagName.toLowerCase();
    const type = element.getAttribute('type')?.toLowerCase();

    switch (tagName) {
        case 'button':
            return 'Button';
        case 'a':
            return 'Link';
        case 'img':
            return 'Image';
        case 'select':
            return 'Dropdown';
        case 'textarea':
            return 'Text Area';
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
            return 'Heading';
        case 'p':
            return 'Paragraph';
        case 'input':
            switch (type) {
                case 'text': case 'email': case 'password': case 'search': case 'tel': case 'url':
                    return 'Text Input';
                case 'number':
                    return 'Number Input';
                case 'radio':
                    return 'Radio Button';
                case 'checkbox':
                    return 'Checkbox';
                case 'submit': case 'button':
                    return 'Button';
                default:
                    return 'Input Field';
            }
        default:

            return tagName.charAt(0).toUpperCase() + tagName.slice(1);
    }
}