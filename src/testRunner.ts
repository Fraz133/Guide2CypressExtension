// --- In testRunner.ts ---

import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel("Guide2Test Logs");
    }
    return outputChannel;
}

export function runTest(
    specPath: string, 
    projectRootUri: vscode.Uri, 
    framework: 'cypress' | 'playwright', 
    browser: string,
    onProcessStart: (process: ChildProcess) => void 
): Promise<{ exitCode: number | null, logs: string }> {
    const channel = getOutputChannel();
    channel.clear();
    channel.show(true);
    channel.appendLine(`🚀 Starting ${framework} test run on ${browser}...`);
    channel.appendLine('--------------------------------------------------');

    let fullLogOutput = '';

    return new Promise((resolve, reject) => {
        const projectRootPath = projectRootUri.fsPath;
        
        let commandString: string;
        
        // --- THE FINAL, CORRECTED IMPLEMENTATION ---

        if (framework === 'playwright') {
            const projectName = browser === 'firefox' ? 'firefox' : browser === 'webkit' ? 'webkit' : 'chromium';
            
            // 1. Create a relative path from the project root.
            const relativeSpecPath = path.relative(projectRootPath, specPath);
            
            // 2. IMPORTANT: Normalize the path to use forward slashes (POSIX style), as recommended.
            const posixRelativeSpecPath = relativeSpecPath.replace(/\\/g, '/');

            // 3. Build the command string with the CORRECT argument order: options first, then the test file filter.
            commandString = `npx playwright test --headed --project=${projectName} "${posixRelativeSpecPath}"`;

        } else { // Cypress logic
            const relativeSpecPath = path.relative(projectRootPath, specPath);
            const cypressSpecPath = relativeSpecPath.replace(/\\/g, '/');
            commandString = `npx cypress run --headed --browser ${browser} --spec "${cypressSpecPath}"`;
        }

        channel.appendLine(`- CWD: ${projectRootPath}`);
        channel.appendLine(`- Executing Command: ${commandString}`);
        
        const testProcess = spawn(commandString, [], {
            cwd: projectRootPath,
            shell: true,
            env: process.env
        });

        onProcessStart(testProcess);
        
        testProcess.stdout.on('data', (data) => {
            const output = data.toString();
            channel.append(output);
            fullLogOutput += output; 
        });

        testProcess.stderr.on('data', (data) => {
            const output = data.toString();
            channel.append(output);
            fullLogOutput += output; 
        });

        testProcess.on('error', (err) => {
            channel.appendLine(`🚨 PROCESS ERROR: ${err.message}`);
            reject(err);
        });

        testProcess.on('close', (code) => {
            channel.appendLine('--------------------------------------------------');
            if (code === 0) {
                channel.appendLine('✅ Test run finished successfully.');
            } else {
                channel.appendLine(`❌ Test run failed with exit code: ${code}.`);
            }
            resolve({ exitCode: code, logs: fullLogOutput });
        });
    });
}