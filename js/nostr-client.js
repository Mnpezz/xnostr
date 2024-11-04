class NostrClient {
    constructor() {
        this.relays = {};
        this.pubkey = null;
        this.profile = null;
        this.profileCache = new Map(); // Cache for profiles
        this.privateKey = null;
    }

    async init() {
        await this.loadSavedRelays();
        console.log('NostrTools available:', window.NostrTools);
        console.log('nostr extension available:', window.nostr);
        this.pubkey = await utils.getPublicKey();
        await this.connectToRelays();
        await this.fetchProfile();
    }

    async initWithPrivateKey(privateKey) {
        await this.loadSavedRelays();
        this.privateKey = privateKey;
        this.pubkey = window.NostrTools.getPublicKey(privateKey);
        await this.connectToRelays();
        await this.fetchProfile();
    }

    async connectToRelays() {
        const { relayInit } = window.NostrTools;
        let connectedRelays = 0;
        
        // Add connection timeout
        const connectionTimeout = 5000; // 5 seconds
        
        for (const url of utils.relayUrls) {
            try {
                console.log(`Attempting to connect to ${url}...`);
                const relay = relayInit(url);
                
                const connectPromise = relay.connect();
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Connection timeout')), connectionTimeout)
                );
                
                await Promise.race([connectPromise, timeoutPromise]);
                
                relay.on('connect', () => {
                    console.log(`Connected to ${url}`);
                    this.relays[url] = relay;
                    connectedRelays++;
                });
                
                relay.on('error', (error) => {
                    console.error(`Error on ${url}:`, error);
                    delete this.relays[url];
                });

                relay.on('disconnect', () => {
                    console.log(`Disconnected from ${url}`);
                    delete this.relays[url];
                });

            } catch (error) {
                console.error(`Failed to connect to ${url}:`, error);
            }
        }

        // Wait a bit for connections to establish
        await new Promise(resolve => setTimeout(resolve, 1000));

        const activeRelays = Object.keys(this.relays).length;
        if (activeRelays === 0) {
            throw new Error('Failed to connect to any relays');
        }

        console.log(`Connected to ${activeRelays} relays:`, Object.keys(this.relays));
    }

    async publishEvent(event) {
        try {
            const eventToSign = {
                kind: event.kind,
                created_at: Math.floor(Date.now() / 1000),
                tags: event.tags || [],
                content: event.content,
                pubkey: this.pubkey
            };

            eventToSign.id = window.NostrTools.getEventHash(eventToSign);

            let signedEvent;
            if (this.privateKey) {
                // Sign with private key
                const sig = window.NostrTools.signEvent(eventToSign, this.privateKey);
                signedEvent = { ...eventToSign, sig };
            } else {
                // Sign with extension
                signedEvent = await window.nostr.signEvent(eventToSign);
            }

            console.log('Publishing event:', signedEvent);

            // Try to publish to each relay
            let published = false;
            const errors = [];

            for (const relay of Object.values(this.relays)) {
                try {
                    await new Promise((resolve, reject) => {
                        const pub = relay.publish(signedEvent);
                        
                        if (pub && typeof pub.on === 'function') {
                            pub.on('ok', () => {
                                console.log(`Published to ${relay.url}`);
                                published = true;
                                resolve();
                            });
                            
                            pub.on('failed', reason => {
                                console.error(`Failed to publish to ${relay.url}:`, reason);
                                reject(reason);
                            });

                            // Add timeout
                            setTimeout(() => reject('Timeout'), 5000);
                        } else {
                            // Handle case where publish returns a promise
                            Promise.resolve(pub)
                                .then(() => {
                                    console.log(`Published to ${relay.url}`);
                                    published = true;
                                    resolve();
                                })
                                .catch(reject);
                        }
                    });
                } catch (error) {
                    errors.push(error.message || error);
                }
            }

            if (!published) {
                throw new Error(`Failed to publish to any relay: ${errors.join(', ')}`);
            }

            console.log('Event published successfully');
            return signedEvent;
        } catch (error) {
            console.error('Error in publishEvent:', error);
            throw error;
        }
    }

    subscribe(filters, onEvent) {
        Object.values(this.relays).forEach(relay => {
            const sub = relay.sub(filters);
            sub.on('event', event => onEvent(event));
        });
    }

    async fetchProfile() {
        const filter = {
            kinds: [0],
            authors: [this.pubkey],
            limit: 1
        };

        console.log('Fetching profile for pubkey:', this.pubkey);

        for (const relay of Object.values(this.relays)) {
            try {
                let sub = relay.sub([filter]);
                
                const events = await new Promise((resolve, reject) => {
                    const events = [];
                    sub.on('event', event => {
                        events.push(event);
                    });
                    sub.on('eose', () => {
                        resolve(events);
                    });
                    setTimeout(() => resolve(events), 3000);
                });

                if (events.length > 0) {
                    const profileEvent = events.sort((a, b) => b.created_at - a.created_at)[0];
                    console.log('Found profile event:', profileEvent);
                    
                    try {
                        const profile = JSON.parse(profileEvent.content);
                        
                        if (profile.about) {
                            const nanoMatch = profile.about.match(/nano_[123456789abcdefghijkmnopqrstuwxyz]{60}/i);
                            if (nanoMatch) {
                                profile.nano_address = nanoMatch[0];
                            }
                        }
                        
                        if (profile.nano) {
                            profile.nano_address = profile.nano;
                        }

                        this.profile = profile;
                        console.log('Parsed profile:', this.profile);
                        sub.unsub();
                        return;
                    } catch (error) {
                        console.error('Error parsing profile content:', error);
                    }
                }
                sub.unsub();
            } catch (error) {
                console.error('Error fetching profile from relay:', error);
            }
        }

        if (!this.profile) {
            console.log('No profile found, creating empty profile');
            this.profile = {
                name: '',
                about: '',
                lud16: '',
                picture: '',
                nip05: '',
                nano_address: ''
            };
        }
    }

    async updateProfile(profileData) {
        console.log('Updating profile with:', profileData);
        
        if (!this.profile) {
            this.profile = {};
        }

        // Clean up nano address format if present
        let nanoAddress = '';
        if (profileData.about) {
            const nanoMatch = profileData.about.match(/(?:Nano:\s*)?((nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59})/i);
            if (nanoMatch) {
                nanoAddress = nanoMatch[1];
                // Remove the nano address from the about field
                profileData.about = profileData.about.replace(/\n?(?:Nano:\s*)?(?:nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59}/i, '').trim();
            }
        }

        // Create a clean profile object
        const cleanProfile = {
            name: profileData.name || this.profile.name || '',
            about: profileData.about + (nanoAddress ? `\nNano: ${nanoAddress}` : ''),
            picture: this.profile.picture || '',
            banner: this.profile.banner || '',
            nip05: this.profile.nip05 || '',
            lud16: profileData.lud16 || this.profile.lud16 || '',
        };

        console.log('Final profile data:', cleanProfile);

        try {
            // Create a proper kind 0 metadata event
            const event = {
                kind: 0,
                content: JSON.stringify(cleanProfile),
                tags: [],
                created_at: Math.floor(Date.now() / 1000),
                pubkey: this.pubkey,
            };

            // Publish the event
            const publishedEvent = await this.publishEvent(event);
            
            // Update local profile if publish was successful
            if (publishedEvent) {
                this.profile = cleanProfile;
                console.log('Profile updated successfully:', this.profile);
            }
        } catch (error) {
            console.error('Error updating profile:', error);
            throw error;
        }
    }

    async createZapRequest(recipientPubkey, amount) {
        try {
            // Create zap request event according to NIP-57
            const zapRequest = {
                kind: 9734,
                created_at: Math.floor(Date.now() / 1000),
                content: '',
                tags: [
                    ['p', recipientPubkey],
                    ['amount', (amount * 1000).toString()], // Convert to millisats
                    ['relays', ...Object.keys(this.relays)],
                ],
            };

            // Sign and publish the event only once
            const signedEvent = await this.publishEvent(zapRequest);
            return signedEvent; // Return the signed event instead of the request
        } catch (error) {
            console.error('Error creating zap request:', error);
            throw error;
        }
    }

    async addRelay(url) {
        if (this.relays[url]) {
            throw new Error('Relay already exists');
        }

        const { relayInit } = window.NostrTools;
        const relay = relayInit(url);
        
        try {
            await relay.connect();
            this.relays[url] = relay;
            this.saveRelays();
        } catch (error) {
            throw new Error('Failed to connect to relay');
        }
    }

    async removeRelay(url) {
        if (this.relays[url]) {
            await this.relays[url].close();
            delete this.relays[url];
            this.saveRelays();
        }
    }

    saveRelays() {
        const urls = Object.keys(this.relays);
        localStorage.setItem('nostr_relays', JSON.stringify(urls));
    }

    async loadSavedRelays() {
        const saved = localStorage.getItem('nostr_relays');
        if (saved) {
            const urls = JSON.parse(saved);
            utils.relayUrls = urls;
        }
    }

    async getProfileForPubkey(pubkey) {
        // Check cache first
        if (this.profileCache.has(pubkey)) {
            return this.profileCache.get(pubkey);
        }

        const profile = await this._fetchProfile(pubkey);
        if (profile) {
            this.profileCache.set(pubkey, profile);
        }
        return profile;
    }

    async _fetchProfile(pubkey) {
        const filter = {
            kinds: [0],
            authors: [pubkey],
            limit: 1
        };

        for (const relay of Object.values(this.relays)) {
            try {
                let sub = relay.sub([filter]);
                
                const events = await new Promise((resolve, reject) => {
                    const events = [];
                    sub.on('event', event => {
                        events.push(event);
                    });
                    sub.on('eose', () => {
                        resolve(events);
                    });
                    setTimeout(() => resolve(events), 3000);
                });

                if (events.length > 0) {
                    const profileEvent = events[0];
                    try {
                        const profile = JSON.parse(profileEvent.content);
                        
                        // Look for Nano address in various formats
                        const findNanoAddress = (text) => {
                            if (!text || typeof text !== 'string') return null;
                            
                            // Match patterns:
                            // 1. Nano: nano_xxx
                            // 2. nano_xxx directly
                            // 3. xno_xxx directly
                            const nanoRegex = /(?:Nano:\s*)?((nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59})/i;
                            const match = text.match(nanoRegex);
                            return match ? match[1] : null;
                        };
                        
                        // Check multiple possible locations for nano address
                        profile.nano_address = 
                            findNanoAddress(profile.nano) || // Check dedicated nano field
                            findNanoAddress(profile.about) || // Check about field
                            findNanoAddress(profile.website) || // Check website field
                            null;

                        sub.unsub();
                        return profile;
                    } catch (error) {
                        console.error('Error parsing profile:', error);
                        sub.unsub();
                        return null;
                    }
                }
                sub.unsub();
            } catch (error) {
                console.error('Error fetching profile:', error);
            }
        }
        return null;
    }

    // Add method to check if profile has nano address
    async hasNanoAddress(pubkey) {
        try {
            const profile = await this.getProfileForPubkey(pubkey);
            if (!profile) return false;
            
            // Check for nano address in various fields
            const findNanoAddress = (text) => {
                if (!text || typeof text !== 'string') return false;
                const nanoRegex = /(?:nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59}/i;
                return nanoRegex.test(text);
            };

            return findNanoAddress(profile.nano) || 
                   findNanoAddress(profile.about) || 
                   findNanoAddress(profile.website);
        } catch (error) {
            console.error('Error checking nano address:', error);
            return false;
        }
    }

    async getReactions(eventId) {
        const reactions = {
            likes: 0,
            liked: false,
            reposted: false
        };

        const seenReactions = new Set(); // Track unique reactions

        const filter = {
            kinds: [7, 6],
            '#e': [eventId]
        };

        for (const relay of Object.values(this.relays)) {
            try {
                const events = await this.queryRelay(relay, filter);
                for (const event of events) {
                    // Create a unique key for this reaction
                    const reactionKey = `${event.kind}-${event.pubkey}-${event.content}`;
                    
                    // Only count if we haven't seen this reaction before
                    if (!seenReactions.has(reactionKey)) {
                        seenReactions.add(reactionKey);
                        
                        if (event.kind === 7 && event.content === '+') {
                            reactions.likes++;
                            if (event.pubkey === this.pubkey) {
                                reactions.liked = true;
                            }
                        } else if (event.kind === 6) {
                            if (event.pubkey === this.pubkey) {
                                reactions.reposted = true;
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error fetching reactions:', error);
            }
        }

        return reactions;
    }

    async getRepostCount(eventId) {
        let count = 0;
        const filter = {
            kinds: [6],
            '#e': [eventId]
        };

        for (const relay of Object.values(this.relays)) {
            try {
                const events = await this.queryRelay(relay, filter);
                count += events.length;
            } catch (error) {
                console.error('Error fetching reposts:', error);
            }
        }

        return count;
    }

    async getRepliesCount(eventId) {
        let count = 0;
        const filter = {
            kinds: [1],
            '#e': [eventId]
        };

        for (const relay of Object.values(this.relays)) {
            try {
                const events = await this.queryRelay(relay, filter);
                count += events.length;
            } catch (error) {
                console.error('Error fetching replies:', error);
            }
        }

        return count;
    }

    async getReplies(eventId) {
        const replies = [];
        const filter = {
            kinds: [1],
            '#e': [eventId]
        };

        for (const relay of Object.values(this.relays)) {
            try {
                const events = await this.queryRelay(relay, filter);
                replies.push(...events);
            } catch (error) {
                console.error('Error fetching replies:', error);
            }
        }

        return replies.sort((a, b) => a.created_at - b.created_at);
    }

    async createReply(eventId, content) {
        const event = {
            kind: 1,
            content: content,
            tags: [['e', eventId]],
            created_at: Math.floor(Date.now() / 1000)
        };

        return await this.publishEvent(event);
    }

    async createRepost(eventId) {
        const event = {
            kind: 6,
            content: '',
            tags: [['e', eventId]],
            created_at: Math.floor(Date.now() / 1000)
        };

        return await this.publishEvent(event);
    }

    async createReaction(eventId, reaction) {
        const event = {
            kind: 7,
            content: reaction,
            tags: [['e', eventId]],
            created_at: Math.floor(Date.now() / 1000)
        };

        return await this.publishEvent(event);
    }

    // Helper method for querying relays
    async queryRelay(relay, filter) {
        return new Promise((resolve, reject) => {
            const events = [];
            const sub = relay.sub([filter]);
            
            sub.on('event', event => {
                events.push(event);
            });
            
            sub.on('eose', () => {
                sub.unsub();
                resolve(events);
            });

            setTimeout(() => {
                sub.unsub();
                resolve(events);
            }, 3000);
        });
    }
} 
