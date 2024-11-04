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

- **Interactive Features**:
  - Threaded conversations
  - Reply support
  - Post likes and boosts
  - Real-time notifications

- **Interface**:
  - Mobile-responsive design
  - Clean, intuitive layout
  - Easy navigation between feeds

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

### For New Users
1. If you're new to Nostr, we recommend:
   - First creating an account on [iris.to](https://iris.to)
   - Getting familiar with Nostr basics
   - Then returning to xnostr with your nsec key

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

## Prerequisites

- Modern web browser
- For desktop:
  - [Alby Extension](https://getalby.com/) for Lightning Network
- For mobile:
  - Your nsec key
- Nano wallet for sending tips

## Technical Details

- Built with vanilla JavaScript
- Uses nostr-tools library
- Implements:
  - NIP-01 (Basic Protocol Flow)
  - NIP-57 (Lightning Zaps)
  - Custom Nano tipping integration

## Security

- Never shares or stores private keys
- Client-side only operation
- Secure connection handling
- Private key input protection

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [Nostr Protocol](https://github.com/nostr-protocol/nips)
- [nano.to](https://nano.to) for Nano payments
- [Alby](https://getalby.com) for Lightning Network integration
- [iris.to](https://iris.to) for Nostr onboarding

## Support

For support, issues, or feature requests, please open an issue on GitHub.
