const utils = {
    relayUrls: [
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.nostr.band',
        'wss://relay.snort.social',
        'wss://strfry.iris.to'
    ],

    async getPublicKey() {
        if (typeof window.nostr === 'undefined') {
            throw new Error('Nostr extension not found');
        }
        return await window.nostr.getPublicKey();
    },

    formatDate(timestamp) {
        return new Date(timestamp * 1000).toLocaleString();
    },

    validateNanoAddress(address) {
        if (!address) return false;
        
        // Remove any "Nano: " prefix if present
        const cleanAddress = address.replace(/^(?:Nano:\s*)?/i, '');
        
        // Updated regex to match both nano_ and xno_ addresses
        const regex = /^(?:nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/i;
        return regex.test(cleanAddress);
    },

    rawToNano(raw) {
        return (BigInt(raw) / BigInt('1000000000000000000000000000000')).toString();
    },

    nanoToRaw(nano) {
        return (BigInt(Math.floor(parseFloat(nano) * 1e30))).toString();
    }
}; 
