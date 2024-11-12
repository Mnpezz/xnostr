class NostrClient {
    constructor() {
        this.relays = {};
        this.pubkey = null;
        this.profile = null;
        this.profileCache = new Map(); // Cache for profiles
        this.privateKey = null;
        this.nanoPosts = new Map(); // Initialize nanoPosts Map
    }

    async init() {
        await this.loadSavedRelays();
        console.log('NostrTools available:', window.NostrTools);
        console.log('nostr extension available:', window.nostr);
        
        try {
            await window.nostr.enable();
            console.log('Nostr permissions granted');
            this.pubkey = await window.nostr.getPublicKey();
            await this.connectToRelays();

            // More aggressive profile fetching for Alby
            console.log('Fetching profile for Alby user:', this.pubkey);
            let profileFetched = false;
            let retryCount = 0;
            const maxRetries = 3;

            while (!profileFetched && retryCount < maxRetries) {
                try {
                    // Fetch profile directly from relays
                    const filter = {
                        kinds: [0],
                        authors: [this.pubkey]
                    };

                    for (const relay of Object.values(this.relays)) {
                        console.log(`Querying ${relay.url} for profile...`);
                        const events = await this.queryRelay(relay, filter);
                        
                        // Sort events by timestamp to get the most recent
                        events.sort((a, b) => b.created_at - a.created_at);
                        
                        if (events.length > 0) {
                            const profileEvent = events[0];
                            try {
                                const profile = JSON.parse(profileEvent.content);
                                console.log('Raw profile data:', profile);
                                
                                // Enhanced profile processing
                                const processedProfile = {
                                    ...profile,
                                    name: profile.name || '',
                                    about: profile.about || '',
                                    picture: profile.picture || '',
                                    banner: profile.banner || '',
                                    nip05: profile.nip05 || '',
                                    lud16: profile.lud16 || ''
                                };

                                // Add nano address detection
                                const nanoAddress = this.findNanoAddress(profile.about) || 
                                                  this.findNanoAddress(profile.nano) ||
                                                  this.findNanoAddress(profile.website);
                                
                                if (nanoAddress) {
                                    processedProfile.nano_address = nanoAddress;
                                    console.log('Found nano address:', nanoAddress);
                                }

                                this.profile = processedProfile;
                                this.profileCache.set(this.pubkey, processedProfile);
                                profileFetched = true;
                                console.log('Successfully loaded profile:', this.profile);
                                break;
                            } catch (error) {
                                console.error('Error parsing profile:', error);
                            }
                        }
                    }
                } catch (error) {
                    console.error(`Profile fetch attempt ${retryCount + 1} failed:`, error);
                }
                retryCount++;
                if (!profileFetched && retryCount < maxRetries) {
                    console.log(`Retrying profile fetch, attempt ${retryCount + 1}...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            if (!this.profile) {
                console.log('No profile found, creating empty profile');
                this.profile = {
                    name: '',
                    about: '',
                    picture: '',
                    banner: '',
                    nip05: '',
                    lud16: '',
                    nano_address: ''
                };
            }
        } catch (error) {
            console.error('Error in init:', error);
            throw error;
        }
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
            limit: 5  // Increased to get potentially different versions
        };

        console.log('Fetching profile for pubkey:', this.pubkey);
        let allEvents = [];

        for (const relay of Object.values(this.relays)) {
            try {
                let sub = relay.sub([filter]);
                
                const events = await new Promise((resolve) => {
                    const events = [];
                    sub.on('event', event => {
                        events.push(event);
                    });
                    sub.on('eose', () => {
                        resolve(events);
                    });
                    setTimeout(() => resolve(events), 3000);
                });

                allEvents.push(...events);
                console.log(`Got ${events.length} profile events from ${relay.url}`);
                events.forEach((event, i) => {
                    console.log(`Profile event ${i} from ${relay.url}:`, {
                        content: event.content,
                        created_at: event.created_at,
                        raw_content: event.content.replace(/\\n/g, '\n')  // Show literal newlines
                    });
                });
            } catch (error) {
                console.error(`Error fetching from ${relay.url}:`, error);
            }
        }

        // Sort all events by timestamp and take the most recent
        allEvents.sort((a, b) => b.created_at - a.created_at);
        
        if (allEvents.length > 0) {
            const profileEvent = allEvents[0];
            console.log('Selected most recent profile event:', {
                relay: profileEvent.relay,
                created_at: profileEvent.created_at,
                content: profileEvent.content,
                raw_content: profileEvent.content.replace(/\\n/g, '\n')
            });
            
            try {
                const profile = JSON.parse(profileEvent.content);
                
                // Log the raw about field with special characters made visible
                if (profile.about) {
                    console.log('About field characters:', Array.from(profile.about).map(c => ({
                        char: c,
                        code: c.charCodeAt(0),
                        hex: c.charCodeAt(0).toString(16)
                    })));
                }

                // Enhanced nano address detection
                const findNanoAddress = (text) => {
                    if (!text || typeof text !== 'string') return null;
                    
                    // Match patterns including newlines and spaces
                    const patterns = [
                        /(?:Nano:\s*)?((nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59})/i,
                        /((?:nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59})/i,
                        /\n\s*((?:nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59})/i
                    ];

                    for (const pattern of patterns) {
                        const match = text.match(pattern);
                        if (match) {
                            return match[1];
                        }
                    }
                    return null;
                };

                // Check for nano address in all fields
                profile.nano_address = 
                    profile.nano ||  // Direct nano field
                    findNanoAddress(profile.about) || 
                    findNanoAddress(profile.website) ||
                    findNanoAddress(profile.display_name) ||
                    findNanoAddress(profile.name);

                this.profile = profile;
                console.log('Final processed profile:', this.profile);
                return;
            } catch (error) {
                console.error('Error parsing profile:', error);
                console.error('Failed content:', profileEvent.content);
            }
        }

        console.log('No valid profile found, creating empty profile');
        this.profile = {
            name: '',
            about: '',
            lud16: '',
            picture: '',
            nip05: '',
            nano_address: ''
        };
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

        const filter = {
            kinds: [0],
            authors: [pubkey],
            limit: 5
        };

        let mostRecentProfile = null;
        let mostRecentTimestamp = 0;

        // Collect all profile events from all relays
        const allProfiles = [];
        
        for (const relay of Object.values(this.relays)) {
            try {
                const events = await this.queryRelay(relay, filter);
                allProfiles.push(...events);
            } catch (error) {
                console.error('Error fetching profile from relay:', error);
            }
        }

        // Sort all profiles by timestamp
        allProfiles.sort((a, b) => b.created_at - a.created_at);

        if (allProfiles.length > 0) {
            try {
                // Start with the most recent profile
                const baseProfile = JSON.parse(allProfiles[0].content);
                
                // Merge in any additional fields from other profiles
                for (let i = 1; i < allProfiles.length; i++) {
                    try {
                        const otherProfile = JSON.parse(allProfiles[i].content);
                        // Merge in any non-empty fields that are missing in the base profile
                        Object.keys(otherProfile).forEach(key => {
                            if (!baseProfile[key] && otherProfile[key]) {
                                baseProfile[key] = otherProfile[key];
                            }
                        });
                    } catch (error) {
                        console.error('Error parsing additional profile:', error);
                    }
                }

                // Process the merged profile
                const processedProfile = {
                    name: baseProfile.name || '',
                    about: baseProfile.about || '',
                    picture: baseProfile.picture || '',
                    banner: baseProfile.banner || '',
                    nip05: baseProfile.nip05 || '',
                    lud16: baseProfile.lud16 || ''
                };

                // Add nano address detection
                const nanoAddress = this.findNanoAddressInProfile(baseProfile);
                if (nanoAddress) {
                    processedProfile.nano_address = nanoAddress;
                }

                // Cache the processed profile
                this.profileCache.set(pubkey, processedProfile);
                return processedProfile;
            } catch (error) {
                console.error('Error processing merged profile:', error);
            }
        }

        // Return empty profile if nothing found
        return {
            name: '',
            about: '',
            picture: '',
            banner: '',
            nip05: '',
            lud16: '',
            nano_address: ''
        };
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
                    const profileEvent = events.sort((a, b) => b.created_at - a.created_at)[0];
                    
                    try {
                        const profile = JSON.parse(profileEvent.content);


                        // Enhanced nano address detection
                        const findNanoAddress = (text) => {
                            if (!text || typeof text !== 'string') return null;
                            
                            // Match patterns including newlines
                            const patterns = [
                                /(?:Nano:\s*)?((nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59})/i,
                                /((?:nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59})/i,
                                /\n\s*((?:nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59})/i
                            ];

                            for (const pattern of patterns) {
                                const match = text.match(pattern);
                                if (match) {
                                    return match[1];
                                }
                            }
                            return null;
                        };

                        // Check for nano address in all fields
                        profile.nano_address = 
                            profile.nano ||  // Direct nano field
                            findNanoAddress(profile.about) || 
                            findNanoAddress(profile.website) ||
                            findNanoAddress(profile.display_name) ||
                            findNanoAddress(profile.name);

                        this.profile = profile;
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

    // Add helper method for sanitizing image URLs
    sanitizeImageUrl(url) {
        if (!url) return null;
        
        try {
            const sanitized = new URL(url);
            
            // Only allow https URLs
            if (sanitized.protocol !== 'https:') {
                return null;
            }
            
            // Expanded list of allowed domains
            const allowedDomains = [
                'nostr.build',
                'void.cat',
                'imgur.com',
                'i.imgur.com',
                'cloudflare-ipfs.com',
                'pomf2.lain.la',
                'media.snort.social',
                'files.masto.host',
                'nostrimg.com',
                'imgproxy.snort.social',
                'files.mastodon.social',
                'sotalive.net',
                'm.primal.net',
                'primal.net',
                'image.nostr.build',
                'cdn.nostr.build',
                'nostr.meme.garden',
                'i.nostrimg.com',
                'media.nostr.band',
                'cdn.nostr.band',
                'nostr.band'
            ];

            // Check if domain is allowed
            if (!allowedDomains.some(domain => sanitized.hostname.includes(domain))) {
                return null;
            }

            return sanitized.toString();
        } catch (error) {
            console.error('Error sanitizing image URL:', error);
            return null;
        }
    }

    // Update hasNanoAddress method
    async hasNanoAddress(pubkey) {
        try {
            // Try all relays and use the first profile that has a nano address
            for (const relay of Object.values(this.relays)) {
                const filter = {
                    kinds: [0],
                    authors: [pubkey],
                    limit: 5  // Increased to get more versions
                };

                const events = await this.queryRelay(relay, filter);

                // Sort by timestamp to get most recent first
                events.sort((a, b) => b.created_at - a.created_at);

                for (const event of events) {
                    try {
                        const profile = JSON.parse(event.content);

                        // Check all possible fields for nano address
                        const nanoAddress = this.findNanoAddressInProfile(profile);
                        
                        if (nanoAddress) {
                            // Cache this profile since it has a nano address
                            this.profileCache.set(pubkey, {
                                ...profile,
                                nano_address: nanoAddress
                            });
                            
                            // Add to nanoPosts immediately
                            await this.addUserToNanoFeed(pubkey, Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60));
                            
                            return true;
                        }
                    } catch (error) {
/*                         console.error('Error parsing profile:', error);
 */                    }
                }
            }

            return false;
        } catch (error) {
            return false;
        }
    }

    // Add helper method to find nano address in any profile field
    findNanoAddressInProfile(profile) {
        if (!profile) return null;

        // Fields to check for nano address
        const fieldsToCheck = ['about', 'nano', 'website', 'display_name', 'name', 'description'];
        
        for (const field of fieldsToCheck) {
            if (profile[field]) {
                const nanoAddress = this.findNanoAddress(profile[field]);
                if (nanoAddress) {
                    return nanoAddress;
                }
            }
        }

        // Also check if there's a direct nano_address field
        if (profile.nano_address) {
            return profile.nano_address;
        }

        return null;
    }

    // Update findNanoAddress to be more robust
    findNanoAddress(text) {
        if (!text || typeof text !== 'string') return null;
                
        // Clean the text first
        const cleanText = text.replace(/\\n/g, '\n').trim();
        
        const patterns = [
            /(?:Nano:\s*)?((nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59})/i,
            /((?:nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59})/i,
            /\n\s*((?:nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59})/i,
            /(?:Address:\s*)?((nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59})/i
        ];

        for (const pattern of patterns) {
            const match = cleanText.match(pattern);
            if (match) {
                return match[1];
            }
        }
        return null;
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
        const replies = new Map(); // Use Map to handle duplicates
        const filter = {
            kinds: [1],
            '#e': [eventId],
            limit: 50 // Increased limit to get more replies
        };

        for (const relay of Object.values(this.relays)) {
            try {
                const events = await this.queryRelay(relay, filter);
                
                for (const event of events) {
                    // Verify this is actually a reply to our event
                    const isDirectReply = event.tags.some(tag => 
                        tag[0] === 'e' && tag[1] === eventId
                    );
                    
                    if (isDirectReply) {
                        // Keep the most recent version of each reply
                        const existing = replies.get(event.id);
                        if (!existing || existing.created_at < event.created_at) {
                            console.log(`Adding/updating reply ${event.id}`);
                            replies.set(event.id, event);
                        }
                    }
                }
            } catch (error) {
                console.error(`Error fetching replies from ${relay.url}:`, error);
            }
        }

        // Convert Map to array and sort by timestamp
        const sortedReplies = Array.from(replies.values())
            .sort((a, b) => a.created_at - b.created_at);
        
        return sortedReplies;
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

    // Add these methods to the NostrClient class

    async discoverNanoUsers(initialPubkey) {
        const discoveredUsers = new Set();
        const queue = [initialPubkey];
        const processed = new Set();
        const since = Math.floor(Date.now() / 1000) - (90 * 24 * 60 * 60); // Last 90 days

        console.log('Starting nano user discovery from:', initialPubkey);

        // Also look for nano addresses in post content
        const findNanoInContent = async (pubkey) => {
            const filter = {
                kinds: [1],
                authors: [pubkey],
                since: since,
                limit: 50
            };

            for (const relay of Object.values(this.relays)) {
                try {
                    const events = await this.queryRelay(relay, filter);
                    for (const event of events) {
                        const nanoMatch = event.content.match(/(?:nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59}/i);
                        if (nanoMatch) {
                            console.log(`Found nano address in post from ${pubkey}`);
                            return true;
                        }
                    }
                } catch (error) {
                    console.error('Error checking posts:', error);
                }
            }
            return false;
        };

        while (queue.length > 0 && discoveredUsers.size < 500) { // Increased limit
            const pubkey = queue.shift();
            if (processed.has(pubkey)) continue;
            processed.add(pubkey);

            try {
                console.log(`Checking user ${pubkey} (Queue: ${queue.length}, Found: ${discoveredUsers.size})`);
                
                // Check profile and posts for nano addresses
                const hasNanoInProfile = await this.hasNanoAddress(pubkey);
                const hasNanoInPosts = await findNanoInContent(pubkey);

                if (hasNanoInProfile || hasNanoInPosts) {
                    discoveredUsers.add(pubkey);
                    console.log(`Found nano user: ${pubkey}`);
                    
                    // Get their interactions immediately
                    const interactions = await this.getUserInteractions(pubkey, since);
                    console.log(`Found ${interactions.length} interactions for nano user ${pubkey}`);
                    
                    // Prioritize checking their interactions
                    for (const interactedPubkey of interactions) {
                        if (!processed.has(interactedPubkey)) {
                            queue.unshift(interactedPubkey); // Add to front of queue
                        }
                    }
                }

                // Get followers and following
                const followFilter = {
                    kinds: [3],
                    authors: [pubkey],
                    limit: 100
                };

                for (const relay of Object.values(this.relays)) {
                    try {
                        const events = await this.queryRelay(relay, followFilter);
                        for (const event of events) {
                            event.tags
                                .filter(tag => tag[0] === 'p')
                                .forEach(tag => {
                                    const followedPubkey = tag[1];
                                    if (!processed.has(followedPubkey)) {
                                        queue.push(followedPubkey);
                                    }
                                });
                        }
                    } catch (error) {
                        console.error('Error fetching follows:', error);
                    }
                }

                // Small delay to prevent overwhelming relays
                await new Promise(resolve => setTimeout(resolve, 50));
            } catch (error) {
                console.error(`Error processing user ${pubkey}:`, error);
            }
        }

        console.log(`Discovery complete. Found ${discoveredUsers.size} nano users`);
        return Array.from(discoveredUsers);
    }

    async getUserInteractions(pubkey, since) {
        const interactedUsers = new Set();
        
        const filters = [
            // Posts and replies
            {
                kinds: [1],
                authors: [pubkey],
                since: since,
                limit: 100
            },
            // Reactions
            {
                kinds: [7],
                authors: [pubkey],
                since: since,
                limit: 100
            },
            // Mentions of the user
            {
                kinds: [1],
                '#p': [pubkey],
                since: since,
                limit: 100
            },
            // Reposts
            {
                kinds: [6],
                authors: [pubkey],
                since: since,
                limit: 100
            },
            // Zaps
            {
                kinds: [9735],
                authors: [pubkey],
                since: since,
                limit: 100
            }
        ];

        for (const relay of Object.values(this.relays)) {
            try {
                for (const filter of filters) {
                    const events = await this.queryRelay(relay, filter);
                    
                    for (const event of events) {
                        // Add author
                        interactedUsers.add(event.pubkey);
                        
                        // Add all tagged users
                        event.tags.forEach(tag => {
                            if (tag[0] === 'p') {
                                interactedUsers.add(tag[1]);
                            }
                        });

                        // Check content for nano addresses
                        const nanoMatch = event.content.match(/(?:nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59}/i);
                        if (nanoMatch) {
                            console.log(`Found post with nano address from ${event.pubkey}`);
                            interactedUsers.add(event.pubkey);
                        }
                    }
                }
            } catch (error) {
                console.error('Error fetching interactions:', error);
            }
        }

        return Array.from(interactedUsers);
    }

    // Add new method for parallel profile checking
    async checkProfilesInParallel(profiles, batchSize = 10) {
        const nanoUsers = new Set();
        const batches = [];
        
        // Split profiles into batches
        for (let i = 0; i < profiles.length; i += batchSize) {
            batches.push(profiles.slice(i, i + batchSize));
        }
        
        // Process batches in parallel
        for (const batch of batches) {
            const promises = batch.map(async (profile) => {
                try {
                    const hasNano = this.findNanoAddress(profile.content);
                    if (hasNano) {
                        const parsed = JSON.parse(profile.content);
                        console.log(`Found nano user: ${profile.pubkey} with profile:`, parsed);
                        nanoUsers.add(profile.pubkey);
                        // Cache the profile
                        this.profileCache.set(profile.pubkey, parsed);
                        // Immediately start fetching their posts
                        this.addUserToNanoFeed(profile.pubkey, Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60));
                    }
                } catch (error) {
                    console.error('Error checking profile:', error);
                }
            });
            
            await Promise.all(promises);
        }
        
        return nanoUsers;
    }

    // Update initializeNanoFeed method to load posts in parallel
    async initializeNanoFeed() {
        console.log('Initializing nano feed...');
        const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
        
        // First check if current user has nano address
        const hasNano = await this.hasNanoAddress(this.pubkey);
        console.log('Current user has nano:', hasNano, 'Profile:', this.profile);
        
        // Search for nano users in parallel
        console.log('Searching for nano users in parallel...');
        const profileFilter = {
            kinds: [0],
            since: thirtyDaysAgo,
            limit: 1000
        };

        const nanoUsers = new Set();
        if (hasNano) nanoUsers.add(this.pubkey);

        // Fetch profiles from all relays in parallel
        const profilePromises = Object.values(this.relays).map(async (relay) => {
            try {
                const events = await this.queryRelay(relay, profileFilter);
                for (const event of events) {
                    try {
                        const profile = JSON.parse(event.content);
                        if (this.findNanoAddress(profile.about) || 
                            this.findNanoAddress(profile.nano) ||
                            this.findNanoAddress(profile.website)) {
                            nanoUsers.add(event.pubkey);
                        }
                    } catch (error) {
                        console.error('Error parsing profile:', error);
                    }
                }
            } catch (error) {
                console.error('Error fetching profiles from relay:', error);
            }
        });

        await Promise.all(profilePromises);
        console.log(`Found ${nanoUsers.size} nano users`);

        // Fetch recent posts from all nano users in parallel
        const postFilter = {
            kinds: [1],
            authors: Array.from(nanoUsers),
            since: thirtyDaysAgo,
            limit: 100
        };

        const postPromises = Object.values(this.relays).map(async (relay) => {
            try {
                const events = await this.queryRelay(relay, postFilter);
                for (const event of events) {
                    if (!event.tags.some(tag => tag[0] === 'e')) { // Skip replies
                        this.nanoPosts.set(event.id, event);
                    }
                }
            } catch (error) {
                console.error('Error fetching posts from relay:', error);
            }
        });

        await Promise.all(postPromises);

        // Sort all posts by timestamp
        const sortedPosts = Array.from(this.nanoPosts.values())
            .sort((a, b) => b.created_at - a.created_at);

        console.log(`Loaded ${sortedPosts.length} nano posts in chronological order`);
        return sortedPosts.length;
    }

    // Update addUserToNanoFeed to cache profiles
    async addUserToNanoFeed(pubkey, since) {
        console.log(`Fetching posts for nano user: ${pubkey}`);
        
        // First ensure we have the user's profile cached
        if (!this.profileCache.has(pubkey)) {
            const profile = await this.getProfileForPubkey(pubkey);
            if (profile) {
                // Make sure to include the nano address in the cached profile
                const nanoAddress = this.findNanoAddressInProfile(profile);
                if (nanoAddress) {
                    profile.nano_address = nanoAddress;
                    this.profileCache.set(pubkey, profile);
                    console.log(`Cached profile for ${pubkey} with nano address:`, nanoAddress);
                }
            }
        }

        const filter = {
            kinds: [1],
            authors: [pubkey],
            since: since,
            limit: 200
        };

        const promises = Object.values(this.relays).map(async (relay) => {
            try {
                const events = await this.queryRelay(relay, filter);
                return events.filter(event => !event.tags.some(tag => tag[0] === 'e')); // Skip replies
            } catch (error) {
                console.error('Error fetching posts:', error);
                return [];
            }
        });

        const allEvents = await Promise.all(promises);
        const uniquePosts = new Map();

        // Combine posts from all relays, keeping only the newest version of each post
        allEvents.flat().forEach(event => {
            const existing = uniquePosts.get(event.id);
            if (!existing || existing.created_at < event.created_at) {
                uniquePosts.set(event.id, event);
            }
        });

        // Add unique posts to nanoPosts
        uniquePosts.forEach(post => {
            this.nanoPosts.set(post.id, post);
        });

        console.log(`Added ${uniquePosts.size} unique posts from ${pubkey}`);
        return uniquePosts.size;
    }

    async fetchProfileFromAllRelays(pubkey) {
        console.log(`Fetching profile from all relays for ${pubkey}...`);
        const filter = {
            kinds: [0],
            authors: [pubkey],
            limit: 10  // Increased limit to get more versions
        };

        let bestProfile = null;
        let mostRecent = 0;

        for (const relay of Object.values(this.relays)) {
            try {
                const events = await this.queryRelay(relay, filter);
                for (const event of events) {
                    if (event.created_at > mostRecent) {
                        try {
                            const profile = JSON.parse(event.content);
                            if (profile.picture) {
                                bestProfile = profile;
                                mostRecent = event.created_at;
                            }
                        } catch (error) {
                            console.error('Error parsing profile:', error);
                        }
                    }
                }
            } catch (error) {
                console.error(`Error fetching from ${relay.url}:`, error);
            }
        }

        if (bestProfile) {
            // Process and cache the profile
            const processedProfile = {
                name: bestProfile.name || '',
                about: bestProfile.about || '',
                picture: bestProfile.picture || '',
                banner: bestProfile.banner || '',
                nip05: bestProfile.nip05 || '',
                lud16: bestProfile.lud16 || '',
                nano_address: this.findNanoAddressInProfile(bestProfile)
            };
            
            this.profileCache.set(pubkey, processedProfile);
            return processedProfile;
        }

        return null;
    }
} 
