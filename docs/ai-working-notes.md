# AI Working Notes

## Project Status - 2024-02-18

### Completed Changes
1. Rebranding from Violentmonkey to MCPMonkey:
   - Updated README.md with new project goals and installation instructions
   - Replaced instances of "Violentmonkey" with "MCPMonkey" in:
     - Localization files (fr, ko, es, etc.)
     - Action helper script
     - Bug report template
     - Various JavaScript files
   - Updated GitHub repository references to point to kstrikis/MCPMonkey

2. Installation Process:
   - Removed store badges and links (Chrome, Firefox, Edge)
   - Added manual installation instructions for Firefox
   - Updated build instructions for development setup

3. Documentation:
   - Added clear acknowledgment of Violentmonkey as base project
   - Updated project description to focus on MCP integration
   - Added use cases for both developers and users
   - Added link to Model Context Protocol (MCP) repository

### Current Configuration
- Node.js version: matches package.json
- Build system: Yarn v1.x
- Development mode: `yarn dev`
- Build commands: 
  - Normal release: `yarn build`
  - Self-hosted: `yarn build:selfHosted`

### Pending Tasks
1. Code Changes:
   - Review and potentially fork @violentmonkey/shortcut package
   - Review and potentially fork @violentmonkey/types package
   - Update any remaining instances of "Violentmonkey" in:
     - Source code comments
     - Documentation files
     - Test files

2. MCP Integration:
   - Implement MCP server management interface
   - Add browser resource access capabilities
   - Develop permissions system for MCP servers
   - Create .mcp.js file handling

3. Documentation Needs:
   - Add Chrome/Edge installation instructions
   - Create detailed MCP server setup guide
   - Document permissions system
   - Add development setup troubleshooting guide

4. Community:
   - Set up community hub website
   - Create contribution guidelines
   - Establish documentation for MCP server development

### Notes
- Currently maintaining compatibility with Violentmonkey's userscript functionality
- Installation requires manual loading through browser debugging tools
- Project focuses on extending functionality rather than replacing existing features
- Need to maintain clear documentation of changes from base project
