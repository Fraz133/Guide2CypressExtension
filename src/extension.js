"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
var vscode = require("vscode");
var path = require("path");
var fs = require("fs");
// This class will manage our Webview Panel
var G2CPanel = /** @class */ (function () {
    function G2CPanel(panel, extensionUri) {
        var _this = this;
        this._disposables = [];
        this._panel = panel;
        this._extensionUri = extensionUri;
        // Set the webview's initial html content
        this._panel.webview.html = this._getHtmlForWebview();
        // Listen for when the panel is disposed
        this._panel.onDidDispose(function () { return _this.dispose(); }, null, this._disposables);
        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(function (message) {
            switch (message.command) {
                case 'getViewState':
                    // The webview is asking for the current state
                    _this.updateView();
                    return;
                case 'startListener':
                    vscode.commands.executeCommand('guide2cypress.startListener');
                    return;
            }
        }, null, this._disposables);
    }
    G2CPanel.createOrShow = function (extensionUri) {
        // This is called when the provider is created, but we don't need to do anything here
        // as the resolveWebviewView method handles the panel creation.
    };
    G2CPanel.revive = function (panel, extensionUri) {
        G2CPanel.currentPanel = new G2CPanel(panel, extensionUri);
    };
    G2CPanel.prototype.dispose = function () {
        G2CPanel.currentPanel = undefined;
        while (this._disposables.length) {
            var x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    };
    // This method is called by the main activate function to update the UI
    G2CPanel.prototype.updateView = function () {
        var state = getExtensionState();
        this._panel.webview.postMessage({ command: 'updateView', state: state });
    };
    G2CPanel.prototype._getHtmlForWebview = function () {
        var webviewPath = vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'main.html');
        return fs.readFileSync(webviewPath.fsPath, 'utf8');
    };
    return G2CPanel;
}());
var extensionState = { isCypressProject: false };
// Keep a reference to our status bar item
var statusBarItem;
// This is the main entry point for the extension
function activate(context) {
    // 1. Create the status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);
    // 2. Register the Webview Panel Provider
    var provider = new G2CPanelViewProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider("guide2cypress.panel", provider));
    // 3. Register commands
    context.subscriptions.push(vscode.commands.registerCommand('guide2cypress.showPanel', function () {
        // This command is implicitly handled by the activity bar view registration
    }));
    context.subscriptions.push(vscode.commands.registerCommand('guide2cypress.startListener', function () {
        if (!extensionState.isCypressProject) {
            vscode.window.showErrorMessage("Cannot start listener: Not in a valid Cypress project.");
            return;
        }
        vscode.window.showInformationMessage("Starting G2C Listener...");
        // We will add server logic here in the next step
    }));
    context.subscriptions.push(vscode.commands.registerCommand('guide2cypress.openProjectFolder', function () {
        vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Select Cypress Project Folder'
        }).then(function (folderUri) {
            if (folderUri && folderUri[0]) {
                vscode.commands.executeCommand('vscode.openFolder', folderUri[0]);
            }
        });
    }));
    // 4. Run initial project check and update UI
    checkCypressProject();
    // 5. Optional: Re-check when the user opens a new folder
    vscode.workspace.onDidChangeWorkspaceFolders(function () {
        checkCypressProject();
    });
}
// Helper function to check for the cypress/e2e directory
function checkCypressProject() {
    return __awaiter(this, void 0, void 0, function () {
        var isProject, workspaceRoot, cypressE2EPath;
        return __generator(this, function (_a) {
            isProject = false;
            if (vscode.workspace.workspaceFolders) {
                workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
                cypressE2EPath = path.join(workspaceRoot, 'cypress', 'e2e');
                try {
                    if (fs.existsSync(cypressE2EPath)) {
                        isProject = true;
                    }
                }
                catch (err) {
                    console.error("Error checking for Cypress project:", err);
                }
            }
            extensionState.isCypressProject = isProject;
            updateUI();
            return [2 /*return*/];
        });
    });
}
// Helper function to update all UI components based on the state
function updateUI() {
    if (extensionState.isCypressProject) {
        statusBarItem.text = "$(check) G2C: Ready";
        statusBarItem.tooltip = "Guide2Cypress is ready. Click to open the panel.";
        statusBarItem.command = 'guide2cypress.showPanel'; // This will be handled by focusing the view
        statusBarItem.show();
    }
    else {
        statusBarItem.text = "$(error) G2C: Open Cypress Project";
        statusBarItem.tooltip = "Click to select your Cypress project folder.";
        statusBarItem.command = 'guide2cypress.openProjectFolder';
        statusBarItem.show();
    }
    // If the panel is visible, tell it to update its content
    if (G2CPanel.currentPanel) {
        G2CPanel.currentPanel.updateView();
    }
}
// Helper function to get the current state
function getExtensionState() {
    return extensionState;
}
// The provider class that tells VS Code how to create our Webview
var G2CPanelViewProvider = /** @class */ (function () {
    function G2CPanelViewProvider(_extensionUri) {
        this._extensionUri = _extensionUri;
    }
    G2CPanelViewProvider.prototype.resolveWebviewView = function (webviewView, context, _token) {
        G2CPanel.currentPanel = new G2CPanel(webviewView, this._extensionUri);
        // When the panel is first created, ensure its content is up-to-date
        updateUI();
    };
    return G2CPanelViewProvider;
}());
function deactivate() { }
