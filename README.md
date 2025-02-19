# MCPMonkey

MCPMonkey is a fork of [Violentmonkey](https://github.com/violentmonkey/violentmonkey), extending its powerful userscript capabilities to support Model Context Protocol (MCP) servers. This project aims to bridge the gap between AI language models and browser interactions.

## About MCPMonkey

MCPMonkey enhances the browser extension capabilities of Violentmonkey to provide a user-friendly interface for managing and using [Model Context Protocol (MCP)](https://github.com/modelcontextprotocol) servers. This allows AI language models like those used in Cursor to interact with your browser in meaningful ways.

### Key Features

- **MCP Server Management**: Install and manage multiple MCP servers directly from your browser
- **Enhanced Browser Access**: Allow AI tools to interact with:
  - Open web pages and tabs
  - Browsing history
  - Bookmarks
  - Dev console logs
  - Other installed extensions
- **User Script Support**: Full compatibility with existing userscripts (inherited from Violentmonkey)
- **Permissions Control**: Fine-grained control over what resources each MCP server can access
- **Community Hub**: Share and discover MCP servers and scripts

## Installation

MCPMonkey is currently available as a development build that you need to install manually.

### Firefox Installation
1. Build the project following the Development instructions below
2. Open Firefox and navigate to `about:debugging`
3. Click "This Firefox" in the left sidebar
4. Click "Load Temporary Add-on..."
5. Navigate to the `dist` folder in your MCPMonkey build directory
6. Select any file from the `dist` folder to load the extension

Note: As this is a temporary installation, you'll need to reload the extension each time you restart Firefox.

## Use Cases

- **For Developers**:
  - Access browser resources directly from Cursor or other AI tools
  - View console logs and debug information in your AI development environment
  - Create custom MCP servers for specific development needs

- **For Users**:
  - Let your desktop chatbot help you find that website you visited last week
  - Allow AI tools to draft social media messages or emails
  - Automate browser interactions through natural language commands

## Development

Install [Node.js](https://nodejs.org/) and Yarn v1.x.  
The version of Node.js should match `"node"` key in `package.json`.

```sh
# Install dependencies
$ yarn

# Watch and compile
$ yarn dev
```

Then load the extension from 'dist/'.

### Build

```sh
# Build for normal releases
$ yarn build

# Build for self-hosted release that has an update_url
$ yarn build:selfHosted
```

## Credits

This project is based on [Violentmonkey](https://github.com/violentmonkey/violentmonkey), an excellent userscript manager that provides the foundation for MCPMonkey's enhanced capabilities. We extend our gratitude to the Violentmonkey team and contributors for their outstanding work.

## Environment Variables

The following environment variables are required for various features:

- `SYNC_GOOGLE_CLIENT_ID` / `SYNC_GOOGLE_CLIENT_SECRET` - Google sync service
- `SYNC_ONEDRIVE_CLIENT_ID` / `SYNC_ONEDRIVE_CLIENT_SECRET` - OneDrive sync service

## Community

Join our community to discuss MCPMonkey, share MCP servers, and get help:

[Community Hub](https://mcpmonkey.org) - Share and discover MCP servers and scripts
[Discord](https://discord.gg/XHtUNSm6Xc) - Join our Discord server for discussions

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

This project is licensed under the same terms as Violentmonkey. See the [LICENSE](LICENSE) file for details.
