# Nostr Nano Client

A specialized Nostr client focused on the Nano cryptocurrency community. This client allows users to view posts from Nostr users who have Nano addresses in their profiles, send Nano tips, and interact with Lightning Network through Zaps.

## Features

- **Nano-Focused Feed**: Toggle between all posts and posts only from users with Nano addresses
- **Hashtag Support**: Automatically includes posts with #nanocurrency
- **Dual Payment Options**: 
  - Send Nano tips directly through nano.to
  - Send Lightning Zaps through Alby
- **Profile Management**:
  - Set your display name
  - Add your Nano address
  - Add your Lightning address
  - View and edit your profile details
- **Relay Management**:
  - Add and remove relays
  - View active relay connections
  - Persistent relay settings

## Prerequisites

- A modern web browser
- [Alby Extension](https://getalby.com/) for Lightning Network interactions
- A Nano wallet for sending tips

## Usage

1. **Connect to Nostr**:
   - Click "Connect to Nostr"
   - Approve the connection in your Alby extension

2. **View Posts**:
   - Toggle "Show only posts from users with Nano addresses" to filter the feed
   - Posts with #nanocurrency will be included
   - Historical posts from users with Nano addresses are automatically loaded

3. **Send Tips**:
   - Click "🥦 Nano Tip" to send Nano through nano.to
   - Click "⚡ Zap" to send sats through Lightning Network

4. **Manage Profile**:
   - Go to the Profile tab
   - Add your Nano address
   - Add your Lightning address
   - Update your display name and about section

5. **Manage Relays**:
   - Go to the Settings tab
   - Add or remove relays
   - Changes are saved automatically

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