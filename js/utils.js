const utils = {
    relayUrls: [
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.nostr.band',
        'wss://relay.snort.social'
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
        const regex = /^(xno|nano)_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/;
        return regex.test(address.toLowerCase());
    },

    rawToNano(raw) {
        return (BigInt(raw) / BigInt('1000000000000000000000000000000')).toString();
    },

    nanoToRaw(nano) {
        return (BigInt(Math.floor(parseFloat(nano) * 1e30))).toString();
    }
}; 