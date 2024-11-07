# xnostr - Nano-Focused Nostr Client

A specialized Nostr client focused on the Nano cryptocurrency community. xnostr allows users to view posts from Nostr users who have Nano addresses in their profiles, send Nano tips, and interact with Lightning Network through Zaps.

Live at https://mnpezz.github.io/xnostr/

## Features

### Core Features
- **Specialized Nano Feed**: 
  - Automatically detects and displays posts from users with Nano addresses
  - Real-time feed updates
  - Smart filtering of Nano-related content

- **Dual Feed System**: 
  - Nano Feed: Focused view of Nano-related posts
  - General Feed: Standard Nostr timeline

- **User Interface**:
  - Dark mode support
  - Mobile-responsive design
  - Character counter for posts
  - Infinite scroll loading
  - Back to top button

### Payment Integration
- **Nano Tips**:
  - Direct Nano tipping through nano.to
  - Automatic Nano address detection
  - Seamless payment experience

- **Lightning Network**:
  - Zap support through Alby
  - Lightning address integration
  - Quick tipping functionality

### User Experience
- **Profile Management**:
  - Easy Nano address integration
  - Lightning address setup
  - Profile customization options
  - Quick copy buttons for addresses

- **Interactive Features**:
  - Threaded conversations
  - Reply support
  - Post likes and boosts
  - Share functionality
  - Real-time notifications

### Technical Features
- **Multiple Login Options**:
  - Alby extension support
  - nsec private key login
  - Secure authentication

- **Relay Management**:
  - Custom relay configuration
  - Automatic relay discovery
  - Connection status monitoring

## Getting Started

### Local Development Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/xnostr.git
   cd xnostr
   ```

2. Serve the files locally:
   - Using Python:
     ```bash
     python -m http.server 8000
     ```
   - Using Node.js:
     ```bash
     npx http-server
     ```
   - Using PHP:
     ```bash
     php -S localhost:8000
     ```

3. Open `http://localhost:8000` in your browser

### For New Users
1. If you're new to Nostr:
   - First create an account on [iris.to](https://iris.to)
   - Get familiar with Nostr basics
   - Return to xnostr with your nsec key

2. Enable Dark Mode (Optional):
   - Click the Settings tab
   - Find the Dark Mode toggle
   - Click to switch between light and dark themes
   - Your preference will be saved automatically

### For Existing Nostr Users
1. **Connect to xnostr**:
   - Desktop: Use Alby extension
   - Mobile: Login with nsec key

2. **Add Your Nano Address**:
   - Go to Profile tab
   - Add your Nano address
   - Save changes

3. **Start Interacting**:
   - View Nano-related posts
   - Send tips
   - Engage with the community

## Usage Tips

### Profile Management
- Your npub and public key are displayed in the Profile tab
- Use the copy buttons for quick sharing
- Add your Nano address in the format: `nano_address` or with prefix `Nano: nano_address`

### Post Creation
- Character limit: 280 characters
- Character counter shows remaining space
- Support for image URLs (automatically embedded)
- Reply to posts by clicking the reply button

### Navigation
- Use the Back to Top button for quick navigation
- Infinite scroll loads more posts automatically
- Switch between Nano and General feeds using tabs

### Dark Mode
- Toggle in Settings tab
- Automatically saves preference
- Improves readability in low-light conditions

### Post Interaction
- Click the reply button (💬) to open the reply form
- Type your reply in the text area
- Click "Send Reply" to post your response
- Replies are shown threaded under the original post
- Reply counts show the number of responses
- Replies are loaded dynamically when viewing a thread

## Prerequisites

- Modern web browser
- For desktop:
  - [Alby Extension](https://getalby.com/) for Lightning Network
- For mobile:
  - Your nsec key
- Nano wallet for sending tips

## Technical Details

### Architecture
- Built with vanilla JavaScript
- No build process required
- Modular design with separate concerns:
  - `app.js`: Main application logic
  - `nostr-client.js`: Nostr protocol handling
  - `utils.js`: Utility functions
  - `styles.css`: All styling

### Implementation Details
- Uses nostr-tools library
- Implements:
  - NIP-01 (Basic Protocol Flow)
  - NIP-57 (Lightning Zaps)
  - Custom Nano tipping integration
- Local storage for preferences
- Real-time updates via WebSocket

## Security Considerations

- Never shares or stores private keys
- Client-side only operation
- Secure connection handling
- Private key input protection
- No external dependencies beyond essential libraries

## Contributing

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/AmazingFeature`
3. Commit your changes: `git commit -m 'Add some AmazingFeature'`
4. Push to the branch: `git push origin feature/AmazingFeature`
5. Open a Pull Request

### Development Guidelines
- Maintain vanilla JavaScript approach
- Follow existing code style
- Add comments for complex logic
- Update README for new features
- Test on both desktop and mobile
- Test both light and dark modes

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [Nostr Protocol](https://github.com/nostr-protocol/nips)
- [nano.to](https://nano.to) for Nano payments
- [Alby](https://getalby.com) for Lightning Network integration
- [iris.to](https://iris.to) for Nostr onboarding

## Support

For support:
- Open an issue on GitHub
- Join the Nostr community
- Follow development updates on Nostr

## Troubleshooting

Common issues and solutions:
1. **Connection Issues**:
   - Check relay connections in Settings
   - Try adding additional relays
   - Verify internet connection

2. **Login Problems**:
   - Ensure Alby is properly installed
   - Verify nsec format
   - Clear browser cache

3. **Display Issues**:
   - Try toggling dark mode
   - Refresh the page
   - Clear browser cache
