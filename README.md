# Nostr Nano Client

A specialized Nostr client focused on the Nano cryptocurrency community. This client allows users to view posts from Nostr users who have Nano addresses in their profiles, send Nano tips, and interact with Lightning Network through Zaps.

Please give everything 5 seconds to load. Nostr seems to take a few seconds to load everything up. after every click.. wait. Please be patient. Thank you. 
Live at https://mnpezz.github.io/xnostr/

## Features

- **Dual Feed System**: 
  - General Feed: View all Nostr posts
  - Nano Feed: View posts only from users with Nano addresses in their profiles
- **Profile Management**:
  - Set your display name
  - Add your Nano address (required for posts to appear in Nano feed)
  - Add your Lightning address
  - View and edit your profile details
- **Payment Options**:
  - Send Nano tips directly through nano.to
  - Send Lightning Zaps through Alby
- **Relay Management**:
  - Add and remove relays
  - View active relay connections
  - Persistent relay settings

## Getting Started

1. **Add Your Nano Address**:
   - Go to the Profile tab
   - Add your Nano address in the profile form
   - Your posts will now appear in the Nano feed

2. **View Nano-Related Content**:
   - Switch to the "Nano Feed" tab
   - See posts from other users who have added their Nano addresses

3. **Send Tips**:
   - Click "🥦 Nano Tip" to send Nano through nano.to
   - Click "⚡ Zap" to send sats through Lightning Network

## Prerequisites

- A modern web browser
- [Alby Extension](https://getalby.com/) for desktop Lightning Network interactions
- A Nano wallet for sending tips
- Your nsec key for mobile login (optional)

## Technical Details

- Built with vanilla JavaScript
- Uses nostr-tools library
- Implements NIP-01 (Basic Protocol Flow)
- Implements NIP-57 (Lightning Zaps)
- Custom implementation for Nano tipping

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [Nostr Protocol](https://github.com/nostr-protocol/nips)
- [nano.to](https://nano.to) for Nano payments
- [Alby](https://getalby.com) for Lightning Network integration
