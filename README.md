# Guide2Cypress Extension

A comprehensive VS Code extension and Chrome extension suite for Cypress test automation, featuring AI-powered test healing, accessibility reporting, visual assertions, and intelligent code generation.

## Project Overview

Guide2Cypress is a dual-extension system that combines a VS Code extension with a Chrome extension to provide a complete Cypress testing experience. The project leverages AI capabilities to automatically heal broken tests, generate accessibility reports, and convert recorded user actions into Cypress test code.

## Features

### VS Code Extension
- **AI-Powered Test Healing**: Automatically suggests fixes for broken Cypress tests using Azure OpenAI
- **Accessibility Report Generation**: Generate comprehensive accessibility reports from axe-core scans
- **Test Code Generation**: Convert recorded user actions into Cypress or Playwright test code
- **Visual Assertions**: Compare screenshots and detect visual differences
- **Integrated Control Panel**: Webview-based control panel for managing test workflows
- **Project Management**: Open and manage Cypress project folders directly from VS Code

### Chrome Extension
- **Action Recording**: Record user interactions on web pages
- **Step Visualization**: Visual representation of recorded test steps
- **Code Generation**: Generate Cypress code from recorded actions
- **AI Integration**: Leverage Azure OpenAI for intelligent test generation
- **Side Panel Interface**: User-friendly side panel for managing recordings

## Technology Stack

### VS Code Extension
- **TypeScript**: Primary development language
- **VS Code API**: Extension development framework
- **Express.js**: Local server for communication
- **Node.js**: Runtime environment
- **Azure OpenAI**: AI services for test healing and code generation

### Chrome Extension
- **JavaScript**: Chrome extension development
- **Chrome Extension API**: Browser automation capabilities
- **HTML2Canvas**: Screenshot capture functionality
- **Axe-core**: Accessibility testing library

## Installation

### Prerequisites
- Node.js >= 18
- VS Code >= 1.80.0
- npm or yarn package manager
- Azure OpenAI account (for AI features)

### VS Code Extension Installation

1. Clone the repository:
```bash
git clone https://github.com/Fraz133/Guide2CypressExtension.git
cd Guide2Cypress
```

2. Install dependencies:
```bash
npm install
```

3. Compile the extension:
```bash
npm run compile
```

4. Run the extension in development mode:
```bash
npm run watch
```

5. Press F5 in VS Code to launch the extension in a new window

### Chrome Extension Installation

1. Navigate to the `Guide2CypressV2-extension` directory
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `Guide2CypressV2-extension` directory

## Configuration

### VS Code Settings

Configure the extension in your VS Code settings:

```json
{
  "guide2cypress.npxPath": "/path/to/npx"
}
```

The `npxPath` setting specifies the absolute path to the npx executable. The extension attempts to find npx automatically from your system PATH, but you can override this if needed.

### Azure OpenAI Configuration

To use AI features, you need to configure your Azure OpenAI credentials:

1. Open `src/extension.ts`
2. Locate the API configuration sections
3. Replace the placeholder with your actual Azure credentials:

```typescript
const endpoint = "YOUR_AZURE_ENDPOINT";
const deployment = "YOUR_DEPLOYMENT_NAME";
const apiKey = "YOUR_AZURE_API_KEY";
const apiVersion = "2024-05-01-preview";
```

**Security Note**: Never commit actual API keys to version control. Use environment variables or secure configuration management in production.

## Usage

### Starting the G2C Listener

1. Open the Command Palette (Ctrl+Shift+P or Cmd+Shift+P)
2. Run "Start G2C Listener"
3. The extension will start a local server to communicate with the Chrome extension

### Recording Test Steps

1. Open the Chrome extension side panel
2. Click "Start Recording"
3. Perform actions on your web application
4. Click "Stop Recording"
5. The recorded steps will be displayed in the side panel

### Generating Test Code

1. After recording steps, click "Generate Cypress Code"
2. The extension will use AI to generate Cypress test code
3. Copy the generated code to your clipboard
4. Paste it into your Cypress test file

### Healing Broken Tests

1. When a Cypress test fails, run "Heal G2C Test"
2. The extension will analyze the error log and recorded steps
3. AI will suggest fixes for broken selectors
4. Apply the suggested fixes to your test

### Accessibility Testing

1. Run "Generate Accessibility Report"
2. The extension will scan your application for accessibility issues
3. A comprehensive Markdown report will be generated
4. Review and fix accessibility violations

### Visual Assertions

1. Use the visual assertion manager to capture screenshots
2. Compare screenshots to detect visual differences
3. Integrate visual assertions into your test suite

## Project Structure

```
Guide2Cypress/
├── src/
│   ├── extension.ts          # Main VS Code extension logic
│   ├── extension.js          # Compiled JavaScript
│   ├── server.ts             # Express server for communication
│   ├── testRunner.ts         # Test runner implementation
│   ├── visualAssertionManager.ts  # Visual assertion logic
│   ├── Webview/
│   │   └── main.html        # Webview UI
│   └── test/
│       ├── extension.test.ts # Extension tests
│       └── extension.test.js # Compiled tests
├── Guide2CypressV2-extension/
│   ├── manifest.json         # Chrome extension manifest
│   ├── background.js         # Chrome extension background script
│   ├── content.js            # Content script for page interaction
│   ├── sidepanel.html        # Side panel UI
│   ├── sidepanel.js          # Side panel logic
│   ├── axe.min.js           # Accessibility testing library
│   ├── html2canvas.min.js   # Screenshot capture library
│   ├── fonts/               # Custom fonts
│   ├── icons/               # Extension icons
│   └── [assets]            # Images and illustrations
├── .vscode/                 # VS Code configuration
├── package.json             # Project dependencies
├── tsconfig.json           # TypeScript configuration
├── eslint.config.mjs       # ESLint configuration
└── README.md               # This file
```

## Development

### Building the Extension

```bash
# Compile TypeScript
npm run compile

# Watch for changes during development
npm run watch

# Run linter
npm run lint

# Run tests
npm run test
```

### Debugging

1. Open the project in VS Code
2. Press F5 to launch the extension in a new VS Code window
3. Use the Chrome DevTools for debugging the Chrome extension
4. Check the VS Code Output panel for extension logs

### Adding New Features

1. Implement the feature in `src/extension.ts`
2. Add corresponding commands to `package.json`
3. Update the webview UI in `src/Webview/main.html`
4. Test thoroughly before committing

## API Reference

### VS Code Commands

- `guide2cypress.showPanel`: Show the Guide2Cypress control panel
- `guide2cypress.startListener`: Start the G2C listener server
- `guide2cypress.healTest`: Heal a broken test using AI
- `guide2cypress.generateA11yReport`: Generate accessibility report
- `guide2cypress.runTest`: Run a Cypress test
- `guide2cypress.stopListener`: Stop the G2C listener
- `guide2cypress.openProjectFolder`: Open Cypress project folder
- `guide2cypress.resetToListener`: Reset to listener state

### Chrome Extension Messages

The Chrome extension communicates with the VS Code extension via a local server using the following message types:

- `START_RECORDING`: Begin recording user actions
- `STOP_RECORDING`: Stop recording and save steps
- `GENERATE_CODE`: Generate test code from recorded steps
- `GET_STEPS`: Retrieve recorded steps

## Troubleshooting

### Extension Not Loading
- Ensure Node.js >= 18 is installed
- Check that all dependencies are installed with `npm install`
- Verify the extension is compiled with `npm run compile`

### AI Features Not Working
- Verify Azure OpenAI credentials are configured
- Check that the endpoint and deployment name are correct
- Ensure your Azure subscription has available quota

### Chrome Extension Not Communicating
- Make sure the G2C listener is started in VS Code
- Check that the local server is running on the correct port
- Verify both extensions are loaded and enabled

## Contributing

Contributions are welcome! To contribute:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Ensure all tests pass
6. Submit a pull request

## License

This project is for demonstration purposes. Please ensure you have appropriate rights to use any assets or code.

## Acknowledgments

- Cypress team for the excellent testing framework
- Microsoft Azure for OpenAI services
- axe-core for accessibility testing
- The open-source community for various libraries and tools

## Version History

- **0.0.1**: Initial release with basic recording and code generation features

## Support

For issues or questions:
- Open an issue on GitHub
- Check the documentation in the repository
- Review the code comments for implementation details

## Security Considerations

- Never commit API keys or sensitive credentials
- Use environment variables for configuration
- Regularly update dependencies for security patches
- Review and audit third-party dependencies

---

**Note**: This extension requires Azure OpenAI credentials for AI features. Ensure you have proper authorization before using these services.
