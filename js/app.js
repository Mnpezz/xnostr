class App {
    constructor() {
        this.nostrClient = new NostrClient();
        this.posts = new Map(); // Store posts in memory
        this.nanoPosts = new Map(); // Store nano-related posts
        this.knownNanoUsers = new Set(); // Cache users with Nano addresses
        this.currentFeedTab = 'nano-feed';
        this.lastLoadedTime = Date.now();
        this.postsPerBatch = 10;
        this.initialLoadLimit = 50;
        this.setupEventListeners();
        this.setupBackToTop();
        document.getElementById('nsec-login-btn')?.addEventListener('click', () => this.loginWithNsec());

        // Add feed state management
        this.feedState = {
            isLoading: false,
            lastUpdate: 0,
            updateInterval: 30000, // 30 seconds
            batchSize: {
                general: 10,  // Smaller batches for general feed
                nano: 5      // Even smaller batches for nano feed for faster loading
            },
            renderedPosts: new Set(), // Track all rendered post IDs
            processedEvents: new Map() // Track all processed events with timestamps
        };

        this.setupNotificationStyles();

        // Add periodic checks for nano user updates
        setInterval(() => {
            if (this.currentFeedTab === 'nano-feed') {
                this.checkNanoUsersForUpdates();
                this.searchForMoreNanoUsers();
            }
        }, 45000);

        // Add immediate check for nano users
        setTimeout(() => {
            this.searchForMoreNanoUsers();
        }, 5000);
    }

    setupEventListeners() {
        document.getElementById('connect-btn').addEventListener('click', () => this.connect());
        document.getElementById('create-post-btn').addEventListener('click', () => this.createPost());
        document.getElementById('profile-form').addEventListener('submit', (e) => this.updateProfile(e));
        document.getElementById('add-relay-btn').addEventListener('click', () => this.addRelay());

        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(button => {
            button.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        // Add scroll event listener for infinite loading
        window.addEventListener('scroll', this.handleScroll.bind(this));
    }

    handleScroll() {
        if ((window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 1000) {
            this.loadMorePosts();
        }
    }

    async loadMorePosts() {
        if (this.feedState.isLoading) return;
        
        const currentTime = Date.now();
        if (currentTime - this.lastLoadedTime < 1500) return; // Increased from 1000 to 1500
        
        this.feedState.isLoading = true;
        this.lastLoadedTime = currentTime;
        
        try {
            const feed = document.getElementById(this.currentFeedTab);
            const posts = this.currentFeedTab === 'nano-feed' ? this.nanoPosts : this.posts;
            const batchSize = this.currentFeedTab === 'nano-feed' ? 
                this.feedState.batchSize.nano : 
                this.feedState.batchSize.general;
            
            const unrenderedPosts = Array.from(posts.values())
                .filter(event => {
                    if (this.feedState.renderedPosts.has(event.id)) return false;
                    if (event.tags.some(tag => tag[0] === 'e')) return false;
                    return true;
                })
                .sort((a, b) => b.created_at - a.created_at);

            let count = 0;
            for (const event of unrenderedPosts) {
                if (count >= batchSize) break;
                
                await this.renderEvent(event, this.currentFeedTab === 'nano-feed');
                this.feedState.renderedPosts.add(event.id);
                count++;

                // Add small delay between renders to prevent UI freezing
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        } finally {
            this.feedState.isLoading = false;
        }
    }

    switchTab(tabId) {
        // Update active button
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });

        // Update active content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === tabId);
        });

        // Handle feed switching
        if (tabId === 'feed-tab') {
            this.currentFeedTab = 'general-feed';
            const generalFeed = document.getElementById('general-feed');
            
            // Only refresh if empty
            if (!generalFeed.querySelector('.post')) {
                this.updateLoadingStatus('Loading general feed...');
                this.refreshGeneralFeed();
            } else {
                // Just check for new posts without clearing
                this.updateLoadingStatus('Checking for new posts...');
                this.checkForNewGeneralPosts();
            }
        } else if (tabId === 'nano-feed-tab') {
            this.currentFeedTab = 'nano-feed';
            const nanoFeed = document.getElementById('nano-feed');
            
            // Only refresh if empty
            if (!nanoFeed.querySelector('.post')) {
                this.updateLoadingStatus('Loading Nano-related posts...');
                this.refreshNanoFeed();
            } else {
                this.updateLoadingStatus('Checking for new Nano content...');
                this.checkForNewNanoPosts();
            }
        }
    }

    // Add new method to check for new posts without clearing the feed
    async checkForNewNanoPosts() {
        if (this.feedState.isLoading) return;
        this.feedState.isLoading = true;
        
        try {
            const feed = document.getElementById('nano-feed');
            
            // Get existing post IDs
            const existingPostIds = new Set(
                Array.from(feed.querySelectorAll('.post'))
                    .map(post => post.id.replace('post-', ''))
            );

            // Get all nano posts and sort by timestamp
            let newPosts = Array.from(this.nanoPosts.values())
                .filter(event => {
                    if (existingPostIds.has(event.id)) return false;
                    if (event.tags.some(tag => tag[0] === 'e')) return false; // Skip replies
                    if (this.feedState.renderedPosts.has(event.id)) return false;
                    return true;
                })
                .sort((a, b) => b.created_at - a.created_at);

            if (newPosts.length > 0) {
                this.updateLoadingStatus(`Found ${newPosts.length} new Nano posts...`);
                
                // Prepend new posts to the feed
                for (const event of newPosts) {
                    const tempDiv = document.createElement('div');
                    await this.renderEvent(event, true, tempDiv);
                    feed.insertBefore(tempDiv.firstChild, feed.firstChild);
                    this.feedState.renderedPosts.add(event.id);
                    await this.loadReplies(event.id);
                    
                    // Add small delay between posts
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }

            this.updateLoadingStatus('Monitoring for new Nano content...');
        } finally {
            this.feedState.isLoading = false;
        }
    }

    clearFeeds() {
        document.getElementById('general-feed').innerHTML = '';
        document.getElementById('nano-feed').innerHTML = '';
    }

    async refreshGeneralFeed() {
        const feed = document.getElementById('general-feed');
        
        // Show initial loading status
        this.updateLoadingStatus('Checking for new posts...');
        
        let posts = Array.from(this.posts.values())
            .sort((a, b) => b.created_at - a.created_at);
        
        // Update loading status with post count
        this.updateLoadingStatus(`Processing ${posts.length} posts from general feed...`);
        
        // Create a Set of all post IDs currently in the feed
        const existingPostIds = new Set(
            Array.from(feed.querySelectorAll('.post'))
                .map(post => post.id.replace('post-', ''))
        );

        // Create a Set to track all posts we've seen (including replies)
        const processedPosts = new Set(existingPostIds);
        
        // First pass: Process main posts and build a map of reply relationships
        const replyToParent = new Map(); // Map reply IDs to their parent IDs
        posts.forEach(event => {
            const isReply = event.tags.some(tag => tag[0] === 'e');
            if (isReply) {
                const parentId = event.tags.find(tag => tag[0] === 'e')?.[1];
                if (parentId) {
                    replyToParent.set(event.id, parentId);
                }
            }
        });

        // Second pass: Render only main posts that aren't replies
        let count = 0;
        for (const event of posts) {
            // Skip if we've already processed this post
            if (processedPosts.has(event.id)) continue;

            const isReply = event.tags.some(tag => tag[0] === 'e');
            if (!isReply) {
                // Skip posts that belong in the nano feed
                if (this.nanoPosts.has(event.id)) {
                    processedPosts.add(event.id);
                    continue;
                }

                // This is a main post
                if (!existingPostIds.has(event.id)) {
                    await this.renderEvent(event, false);
                    count++;
                    if (count >= this.initialLoadLimit) break;
                }
                processedPosts.add(event.id);

                // Mark any replies to this post as processed
                posts.forEach(potentialReply => {
                    if (replyToParent.get(potentialReply.id) === event.id) {
                        processedPosts.add(potentialReply.id);
                    }
                });
            }
        }

        // Only show the searching message if there are no posts at all
        if (feed.children.length === 0) {
            feed.innerHTML = '<div class="no-posts">Searching for posts... Please wait.</div>';
        } else {
            // Remove any existing "searching" message if we have posts
            const searchingMsg = feed.querySelector('.no-posts');
            if (searchingMsg) {
                searchingMsg.remove();
            }
        }

        this.updateLoadingStatus(count > 0 ? 
            `Finished processing ${count} posts from general feed` : 
            'Monitoring for new posts...');
    }

    async refreshNanoFeed() {
        if (this.feedState.isLoading) return;
        this.feedState.isLoading = true;
        
        try {
            const feed = document.getElementById('nano-feed');
            
            // Get all nano posts and sort by timestamp (newest first)
            let posts = Array.from(this.nanoPosts.values())
                .filter(event => {
                    // Keep the post if:
                    // 1. Author is a known nano user
                    if (this.knownNanoUsers.has(event.pubkey)) return true;
                    
                    // 2. Post contains a nano address
                    if (this.hasNanoInContent(event.content)) return true;
                    
                    // 3. It's a reply to a nano post
                    if (event.tags.some(tag => tag[0] === 'e')) {
                        const parentId = event.tags.find(tag => tag[0] === 'e')?.[1];
                        return this.nanoPosts.has(parentId);
                    }
                    
                    return false;
                })
                .sort((a, b) => b.created_at - a.created_at); // Sort by timestamp, newest first
            
            this.updateLoadingStatus(`Processing ${posts.length} Nano-related posts...`);
            
            // Clear existing feed to prevent duplicates
            feed.innerHTML = '';
            this.feedState.renderedPosts.clear(); // Clear rendered posts tracking
            
            // Render posts in batches
            const batchSize = this.feedState.batchSize.nano;
            let count = 0;
            
            for (const event of posts) {
                if (count >= this.initialLoadLimit) break;
                
                await this.renderEvent(event, true);
                this.feedState.renderedPosts.add(event.id);
                await this.loadReplies(event.id);
                
                count++;
                
                // Add small delay between renders to prevent UI freezing
                if (count % 5 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }

            if (feed.children.length === 0) {
                feed.innerHTML = '<div class="no-posts">Searching for Nano-related posts...</div>';
            } else {
                this.updateLoadingStatus(`Monitoring for new Nano content...`);
            }
        } finally {
            this.feedState.isLoading = false;
        }
    }

    // Add new method to continuously search for nano users
    async searchForMoreNanoUsers() {
        try {
            console.log('Searching for more Nano users...');
            // Look back further for profiles
            const since = Math.floor(Date.now() / 1000) - (180 * 24 * 60 * 60); // Last 180 days
            
            // Search both profiles and posts for nano addresses
            const filters = [
                {
                    kinds: [0], // Profile updates
                    since: since
                },
                {
                    kinds: [1], // Posts (to check content and authors)
                    since: since,
                    limit: 500
                }
            ];

            for (const relay of Object.values(this.nostrClient.relays)) {
                for (const filter of filters) {
                    let sub = relay.sub([filter]);
                    sub.on('event', async event => {
                        try {
                            if (this.knownNanoUsers.has(event.pubkey)) return;

                            let hasNano = false;
                            if (event.kind === 0) {
                                // Check profile
                                const profile = JSON.parse(event.content);
                                hasNano = this.hasNanoInProfile(profile);
                            } else if (event.kind === 1) {
                                // Check post content for nano addresses
                                hasNano = this.hasNanoInContent(event.content);
                            }

                            if (hasNano) {
                                console.log('Found new Nano user:', event.pubkey);
                                await this.addNanoUser(event.pubkey);
                                // Trigger feed refresh when new nano user is found
                                if (this.currentFeedTab === 'nano-feed') {
                                    await this.checkForNewNanoPosts();
                                }
                            }
                        } catch (error) {
                            console.error('Error processing potential nano user:', error);
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Error searching for nano users:', error);
        }
    }

    // Add new helper methods
    hasNanoInContent(content) {
        if (!content) return false;
        const nanoRegex = /(?:nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59}/i;
        return nanoRegex.test(content);
    }

    async addNanoUser(pubkey) {
        if (this.knownNanoUsers.has(pubkey)) return;
        
        console.log(`Found new Nano user: ${pubkey}`);
        this.knownNanoUsers.add(pubkey);
        
        // Fetch user's posts
        const since = Math.floor(Date.now() / 1000) - (90 * 24 * 60 * 60);
        const userPosts = await this.fetchUserPosts(pubkey, since);
        
        let newPosts = 0;
        for (const post of userPosts) {
            if (!this.nanoPosts.has(post.id)) {
                this.nanoPosts.set(post.id, post);
                newPosts++;
            }
        }

        if (newPosts > 0 && this.currentFeedTab === 'nano-feed') {
            this.updateLoadingStatus(`Found ${newPosts} posts from new Nano user...`);
            await this.refreshNanoFeed();
        }

        // Also check their recent interactions
        const interactions = await this.fetchUserInteractions(pubkey);
        for (const interactedPubkey of interactions) {
            if (!this.knownNanoUsers.has(interactedPubkey)) {
                const profile = await this.nostrClient.getProfileForPubkey(interactedPubkey);
                if (profile && this.hasNanoInProfile(profile)) {
                    await this.addNanoUser(interactedPubkey);
                }
            }
        }
    }

    async fetchUserInteractions(pubkey) {
        const interactedUsers = new Set();
        const since = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
        
        const filter = {
            kinds: [1],
            authors: [pubkey],
            since: since,
            limit: 100
        };

        for (const relay of Object.values(this.nostrClient.relays)) {
            try {
                const events = await this.nostrClient.queryRelay(relay, filter);
                for (const event of events) {
                    // Get pubkeys from tags
                    event.tags.forEach(tag => {
                        if (tag[0] === 'p') {
                            interactedUsers.add(tag[1]);
                        }
                    });
                }
            } catch (error) {
                console.error('Error fetching user interactions:', error);
            }
        }

        return Array.from(interactedUsers);
    }

    async connect() {
        try {
            // Check if Alby is installed
            if (typeof window.nostr === 'undefined') {
                window.open('https://getalby.com', '_blank');
                alert('Please install the Alby extension and refresh the page');
                return;
            }

            // Try to enable Nostr
            try {
                await window.nostr.enable();
                console.log('Nostr permissions granted');
            } catch (error) {
                console.error('Error enabling Nostr:', error);
                alert('Please grant permissions in the Alby extension popup');
                return;
            }

            await this.nostrClient.init();
            document.getElementById('login-section').style.display = 'none';
            document.getElementById('feed-section').style.display = 'block';
            
            // Set nano feed tab as active
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tab === 'nano-feed-tab');
            });
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.toggle('active', content.id === 'nano-feed-tab');
            });

            this.loadProfile();
            this.setupFeed();
            this.updateRelayList();
        } catch (error) {
            console.error('Connection error:', error);
            alert('Failed to connect: ' + error.message);
        }
    }

    loadProfile() {
        console.log('Current profile data:', this.nostrClient.profile);
        
        if (this.nostrClient.profile) {
            // Extract nano address using the improved pattern
            const about = this.nostrClient.profile.about || '';
            const nanoMatch = about.match(/(?:Nano:\s*)?((nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59})/i);
            const nanoAddress = nanoMatch ? nanoMatch[1] : '';
            
            // Clean the about text by removing the nano address
            const cleanAbout = about.replace(/\n?(?:Nano:\s*)?(?:nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59}/i, '').trim();

            // Display current profile
            const currentProfile = document.getElementById('current-profile');
            currentProfile.innerHTML = `
                <div><strong>Name:</strong> ${this.nostrClient.profile.name || 'Not set'}</div>
                <div><strong>About:</strong> ${cleanAbout || 'Not set'}</div>
                <div><strong>Nano Address:</strong> ${nanoAddress || 'Not set'}</div>
                <div><strong>Lightning:</strong> ${this.nostrClient.profile.lud16 || 'Not set'}</div>
                <div><strong>NIP-05:</strong> ${this.nostrClient.profile.nip05 || 'Not set'}</div>
                ${this.nostrClient.profile.picture ? 
                    `<div><strong>Picture:</strong> <img src="${this.nostrClient.profile.picture}" width="50" onerror="this.style.display='none'"></div>` : 
                    '<div><strong>Picture:</strong> Not set</div>'
                }
            `;

            // Pre-fill form with existing data
            document.getElementById('profile-name').value = this.nostrClient.profile.name || '';
            document.getElementById('profile-about').value = cleanAbout || '';
            document.getElementById('profile-nano').value = nanoAddress || '';
            document.getElementById('profile-lightning').value = this.nostrClient.profile.lud16 || '';
        } else {
            console.log('No profile data available');
            // Clear the form
            document.getElementById('profile-name').value = '';
            document.getElementById('profile-about').value = '';
            document.getElementById('profile-nano').value = '';
            document.getElementById('profile-lightning').value = '';
        }
    }

    updateRelayList() {
        const relayList = document.getElementById('relay-list');
        relayList.innerHTML = '';

        Object.keys(this.nostrClient.relays).forEach(url => {
            const div = document.createElement('div');
            div.className = 'relay-item';
            div.innerHTML = `
                <span>${url}</span>
                <button onclick="app.removeRelay('${url}')">Remove</button>
            `;
            relayList.appendChild(div);
        });
    }

    async addRelay() {
        const input = document.getElementById('new-relay');
        const url = input.value.trim();
        
        if (!url.startsWith('wss://')) {
            alert('Relay URL must start with wss://');
            return;
        }

        try {
            await this.nostrClient.addRelay(url);
            input.value = '';
            this.updateRelayList();
        } catch (error) {
            alert('Failed to add relay: ' + error.message);
        }
    }

    async removeRelay(url) {
        await this.nostrClient.removeRelay(url);
        this.updateRelayList();
    }

    async fetchUserPosts(pubkey, since) {
        const userPosts = new Map();
        const filter = {
            kinds: [1],
            authors: [pubkey],
            since: since,
            limit: 50  // Reduced from 200 to get initial content faster
        };

        console.log(`Fetching posts for Nano user: ${pubkey}`);
        
        let postsLoaded = 0;
        const maxPosts = 100; // Cap total posts per user
        
        for (const relay of Object.values(this.nostrClient.relays)) {
            try {
                if (postsLoaded >= maxPosts) break;
                
                const events = await this.nostrClient.queryRelay(relay, filter);
                for (const event of events) {
                    if (postsLoaded >= maxPosts) break;
                    
                    // Only add if not already in userPosts or if this is a newer version
                    const existingPost = userPosts.get(event.id);
                    if (!existingPost || existingPost.created_at < event.created_at) {
                        userPosts.set(event.id, event);
                        postsLoaded++;
                    }
                    
                    // Add small delay every 10 posts to keep UI responsive
                    if (postsLoaded % 10 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }
                }
            } catch (error) {
                console.error('Error fetching user posts:', error);
            }
        }

        const posts = Array.from(userPosts.values())
            .sort((a, b) => b.created_at - a.created_at)
            .slice(0, maxPosts); // Ensure we don't exceed max posts

        console.log(`Found ${posts.length} unique posts from Nano user ${pubkey}`);
        return posts;
    }

    async setupFeed() {
        // Adjust time windows
        const generalSince = Math.floor(Date.now() / 1000) - (24 * 60 * 60); // Reduced to 24 hours
        const nanoSince = Math.floor(Date.now() / 1000) - (90 * 24 * 60 * 60);
        
        let pendingNanoUsers = new Set();

        this.updateLoadingStatus('Connecting to Nostr network...');
        
        // Load smaller initial batch of general feed
        const initialGeneralFilter = {
            kinds: [1],
            since: generalSince,
            limit: 15  // Reduced initial load
        };

        try {
            // Quick load of general feed
            this.updateLoadingStatus('Loading initial posts...');
            for (const relay of Object.values(this.nostrClient.relays)) {
                const events = await this.nostrClient.queryRelay(relay, initialGeneralFilter);
                for (const event of events) {
                    if (!event.tags.some(tag => tag[0] === 'e')) {
                        await this.processNewPost(event, false);
                        // Add small delay between processing posts
                        await new Promise(resolve => setTimeout(resolve, 20));
                    }
                }
            }

            // Switch to general feed to show the loaded posts
            document.getElementById('feed-tab').click();
            
            // Now start loading nano feed in parallel
            this.updateLoadingStatus('Loading Nano-related posts in background...');
            
            // Check current user's nano status
            const hasNano = await this.nostrClient.hasNanoAddress(this.nostrClient.pubkey);
            if (hasNano) {
                console.log('Current user has Nano address, fetching their posts...');
                this.knownNanoUsers.add(this.nostrClient.pubkey);
                const userPosts = await this.fetchUserPosts(this.nostrClient.pubkey, nanoSince);
                
                let processedCount = 0;
                for (const post of userPosts) {
                    if (!this.nanoPosts.has(post.id)) {
                        this.nanoPosts.set(post.id, post);
                        processedCount++;
                        
                        // Render posts as they come in if we're in nano feed
                        if (this.currentFeedTab === 'nano-feed' && processedCount <= this.feedState.batchSize.nano) {
                            await this.renderEvent(post, true);
                            this.feedState.renderedPosts.add(post.id);
                        }
                        
                        // Add small delay every few posts
                        if (processedCount % 5 === 0) {
                            await new Promise(resolve => setTimeout(resolve, 10));
                        }
                    }
                }
                
                if (processedCount > 0) {
                    this.updateLoadingStatus(`Loaded ${processedCount} posts from current user...`);
                }
            }

            // Set up subscription for ongoing updates
            const filters = [
                {
                    kinds: [1],
                    since: generalSince,
                    limit: this.initialLoadLimit
                }
            ];

            this.nostrClient.subscribe(filters, async event => {
                try {
                    // Skip replies - they'll be handled by their parent posts
                    const isReply = event.tags.some(tag => tag[0] === 'e');
                    if (isReply) return;

                    if (!this.knownNanoUsers.has(event.pubkey) && !pendingNanoUsers.has(event.pubkey)) {
                        pendingNanoUsers.add(event.pubkey);
                        
                        const hasNano = await this.nostrClient.hasNanoAddress(event.pubkey);
                        if (hasNano) {
                            this.knownNanoUsers.add(event.pubkey);
                            
                            // Remove user's posts from general feed
                            for (const [id, post] of this.posts.entries()) {
                                if (post.pubkey === event.pubkey) {
                                    this.posts.delete(id);
                                    this.feedState.renderedPosts.delete(id);
                                }
                            }
                            
                            // Fetch and process user's posts
                            const userPosts = await this.fetchUserPosts(event.pubkey, nanoSince);
                            for (const post of userPosts) {
                                await this.processNewPost(post, true);
                            }
                        } else {
                            await this.processNewPost(event, false);
                        }
                        pendingNanoUsers.delete(event.pubkey);
                    }
                } catch (error) {
                    console.error('Error processing event:', error);
                    pendingNanoUsers.delete(event.pubkey);
                }
            });

        } catch (error) {
            console.error('Error in setupFeed:', error);
            this.showErrorMessage('Error loading feed: ' + error.message);
        }
    }

    async fetchHistoricalPosts() {
        const since = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
        
        for (const relay of Object.values(this.nostrClient.relays)) {
            try {
                // First get all profiles with nano addresses
                const profileFilter = {
                    kinds: [0],
                    since: since
                };

                let sub = relay.sub([profileFilter]);
                const profiles = await new Promise((resolve) => {
                    const profiles = new Set();
                    sub.on('event', event => {
                        try {
                            const profile = JSON.parse(event.content);
                            // More robust check for nano address
                            const hasNano = this.hasNanoInProfile(profile);
                            if (hasNano) {
                                profiles.add(event.pubkey);
                                this.knownNanoUsers.add(event.pubkey);
                            }
                        } catch (error) {
                            console.error('Error parsing profile:', error);
                        }
                    });
                    
                    sub.on('eose', () => {
                        resolve(profiles);
                    });

                    setTimeout(() => resolve(profiles), 8000);
                });

                // Then get posts from these users
                if (profiles.size > 0) {
                    const postFilter = {
                        kinds: [1],
                        authors: Array.from(profiles),
                        since: since,
                        limit: 1000
                    };

                    sub = relay.sub([postFilter]);
                    sub.on('event', event => {
                        // Only add to nano posts, not general posts
                        if (!this.nanoPosts.has(event.id)) {
                            this.nanoPosts.set(event.id, event);
                            // Remove from general posts if it exists there
                            this.posts.delete(event.id);
                            
                            if (this.currentFeedTab === 'nano-feed') {
                                this.renderEvent(event, true);
                            }
                        }
                    });
                }
            } catch (error) {
                console.error('Error fetching historical posts:', error);
            }
        }
    }

    hasNanoInProfile(profile) {
        if (!profile) return false;
        
        const findNanoAddress = (text) => {
            if (!text) return false;
            text = String(text || ''); // Convert to string or empty string if null/undefined
            const nanoRegex = /(?:nano:\s*)?(?:nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59}/i;
            return nanoRegex.test(text);
        };

        return findNanoAddress(profile.nano) || 
               findNanoAddress(profile.about) || 
               findNanoAddress(profile.website) ||
               findNanoAddress(profile.display_name) ||
               findNanoAddress(profile.name);
    }

    async renderEvent(event, isNanoFeed = false, container = null) {
        const feedId = isNanoFeed ? 'nano-feed' : 'general-feed';
        
        // Check if this event is already rendered
        if (document.getElementById(`post-${event.id}`)) {
            return;
        }

        const feed = container || document.getElementById(feedId);
        if (!feed) return;

        // Skip if this is a reply - replies will be handled by loadReplies
        const isReply = event.tags.some(tag => tag[0] === 'e');
        if (isReply) {
            const parentId = event.tags.find(tag => tag[0] === 'e')?.[1];
            const parentPost = document.getElementById(`post-${parentId}`);
            if (parentPost) {
                // If parent exists, trigger a refresh of its replies
                await this.loadReplies(parentId);
                return;
            }
        }

        const div = document.createElement('div');
        div.className = 'post';
        div.id = `post-${event.id}`;
        div.dataset.timestamp = event.created_at.toString();
        
        if (event.kind === 1) {
            try {
                const authorProfile = await this.getProfileForPubkey(event.pubkey);
                const paymentButtons = this.createPaymentButtons(authorProfile, event.pubkey);
                
                // Get reaction counts
                const reactions = await this.nostrClient.getReactions(event.id);
                const repostCount = await this.nostrClient.getRepostCount(event.id);
                const repliesCount = await this.nostrClient.getRepliesCount(event.id);
                
                // Process content to render images with better error handling
                let processedContent = event.content;

                // Handle direct image URLs
                processedContent = processedContent.replace(
                    /(https?:\/\/[^\s<]+?\.(?:jpg|jpeg|gif|png|webp))(?:\s|$)/gi,
                    (match, url) => {
                        // Skip 4chan and other problematic domains
                        if (url.includes('4cdn.org')) {
                            return url; // Return as text instead of image
                        }
                        return `<img src="${url}" class="post-image" onerror="this.style.display='none'; this.parentElement.textContent='${url}'" /><br>`;
                    }
                );

                // Handle nostr.build image URLs
                processedContent = processedContent.replace(
                    /@(https?:\/\/[^\s<]+?\.(?:jpg|jpeg|gif|png|webp))(?:\s|$)/gi,
                    (match, url) => {
                        if (url.includes('4cdn.org')) {
                            return url;
                        }
                        return `<img src="${url}" class="post-image" onerror="this.style.display='none'; this.parentElement.textContent='${url}'" /><br>`;
                    }
                );

                div.innerHTML = `
                    <p class="content">${processedContent}</p>
                    <p class="meta">Posted by ${authorProfile?.name || event.pubkey.slice(0, 8)}... on ${utils.formatDate(event.created_at)}</p>
                    ${paymentButtons}
                    <div class="post-actions">
                        <button class="action-btn reply-btn" onclick="app.showReplyForm('${event.id}')">
                            💬 Reply (${repliesCount})
                        </button>
                        <button class="action-btn repost-btn ${reactions.reposted ? 'active' : ''}" 
                                onclick="app.repost('${event.id}')">
                            🔁 Boost (${repostCount})
                        </button>
                        <button class="action-btn like-btn ${reactions.liked ? 'active' : ''}" 
                                onclick="app.react('${event.id}', '+')">
                            ❤️ Like (${reactions.likes})
                        </button>
                    </div>
                    <div id="reply-form-${event.id}" class="reply-form" style="display: none;">
                        <textarea placeholder="Write your reply..."></textarea>
                        <button onclick="app.submitReply('${event.id}')">Send Reply</button>
                    </div>
                    <div id="replies-${event.id}" class="replies"></div>
                `;

                feed.appendChild(div);

                // Load replies immediately after rendering the post
                if (!isReply) {
                    await this.loadReplies(event.id);
                }
            } catch (error) {
                console.error('Error rendering event:', error);
                div.innerHTML = `
                    <p class="content">${event.content}</p>
                    <p class="meta">Posted by ${event.pubkey.slice(0, 8)}... on ${utils.formatDate(event.created_at)}</p>
                `;
                feed.appendChild(div);
            }
        }
    }

    createPaymentButtons(profile, pubkey) {
        const buttons = [];
        
        // Add Nano tip button if address exists
        if (profile?.nano_address) {
            buttons.push(`
                <button class="tip-button nano-tip" onclick="app.sendNanoTip('${profile.nano_address}', '${profile.name || 'User'}')">
                    🥦 Nano Tip
                </button>
            `);
        }
        
        // Add Zap button if lightning address exists
        if (profile?.lud16) {
            buttons.push(`
                <button class="tip-button zap-tip" onclick="app.sendZap('${pubkey}')">
                    ⚡ Zap
                </button>
            `);
        }
        
        return buttons.length ? `<div class="tip-buttons">${buttons.join('')}</div>` : '';
    }

    async getProfileForPubkey(pubkey) {
        const filter = {
            kinds: [0],
            authors: [pubkey]
        };
        
        for (const relay of Object.values(this.nostrClient.relays)) {
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
                    const profile = JSON.parse(profileEvent.content);
                    
                    // Look for Nano address in about field or custom fields
                    if (profile.about) {
                        const nanoMatch = profile.about.match(/nano_[123456789abcdefghijkmnopqrstuwxyz]{60}/i);
                        if (nanoMatch) {
                            profile.nano_address = nanoMatch[0];
                        }
                    }
                    
                    // Also check for custom nano field
                    if (profile.nano) {
                        profile.nano_address = profile.nano;
                    }

                    sub.unsub();
                    return profile;
                }
                sub.unsub();
            } catch (error) {
                console.error('Error fetching profile:', error);
            }
        }
        return null;
    }

    async sendNanoTip(address, recipientName) {
        try {
            // Prompt for amount
            const amount = prompt('Enter amount in NANO:', '0.133');
            if (!amount) return; // User cancelled

            // Validate amount is a valid number
            const nanoAmount = parseFloat(amount);
            if (isNaN(nanoAmount) || nanoAmount <= 0) {
                alert('Please enter a valid amount');
                return;
            }

            // Use nano.to for payment
            NanoPay.open({
                title: `Tip ${recipientName}`,
                address: address,
                amount: nanoAmount,
                success: (block) => {
                    console.log('Payment successful:', block);
                    alert(`Nano tip sent successfully! Amount: ${nanoAmount} NANO`);
                },
                cancel: () => {
                    console.log('Payment cancelled');
                }
            });
        } catch (error) {
            console.error('Failed to send Nano tip:', error);
            alert('Failed to send Nano tip: ' + error.message);
        }
    }

    async sendZap(pubkey) {
        try {
            if (!this.nostrClient.privateKey && typeof window.webln === 'undefined') {
                this.showErrorMessage('Please install Alby or another WebLN provider to send zaps');
                return;
            }

            const authorProfile = await this.getProfileForPubkey(pubkey);
            if (!authorProfile?.lud16) {
                this.showErrorMessage('This user has not set up Lightning payments');
                return;
            }

            const amount = prompt('Enter amount in sats:', '1000');
            if (!amount) return;

            const sats = parseInt(amount);
            if (isNaN(sats) || sats <= 0) {
                this.showErrorMessage('Please enter a valid amount');
                return;
            }

            try {
                await this.processZap(authorProfile.lud16, sats, pubkey);
                this.showSuccessMessage('Zap sent successfully!');
            } catch (error) {
                throw new Error(`Failed to process zap: ${error.message}`);
            }
        } catch (error) {
            console.error('Zap error:', error);
            this.showErrorMessage('Failed to send zap: ' + error.message);
        }
    }

    async processZap(lnurl, amount, recipientPubkey) {
        try {
            // Convert Lightning Address to LNURL endpoint
            let endpoint;
            if (lnurl.includes('@')) {
                const [name, domain] = lnurl.split('@');
                endpoint = `https://${domain}/.well-known/lnurlp/${name}`;
            }

            // Fetch the LNURL details
            const response = await fetch(endpoint, {
                method: 'GET',
                mode: 'cors',
                headers: {
                    'Accept': 'application/json'
                }
            });
            const lnurlData = await response.json();

            if (!lnurlData.callback) {
                throw new Error('Invalid LNURL response');
            }

            // Create zap request
            const zapRequest = await this.nostrClient.createZapRequest(recipientPubkey, amount);
            const nostrJson = encodeURIComponent(JSON.stringify(zapRequest));
            const callbackUrl = `${lnurlData.callback}?amount=${amount * 1000}&nostr=${nostrJson}`;
            
            // Get the invoice
            const callbackResponse = await fetch(callbackUrl);
            const invoiceData = await callbackResponse.json();

            if (!invoiceData.pr) {
                throw new Error('No payment request received');
            }

            // Handle payment based on login type
            if (this.nostrClient.privateKey) {
                // For nsec users, copy invoice to clipboard
                await navigator.clipboard.writeText(invoiceData.pr);
                alert('Invoice copied to clipboard! Please pay with your Lightning wallet.');
            } else {
                // For Alby users, use WebLN
                await window.webln.enable();
                await window.webln.sendPayment(invoiceData.pr);
            }
        } catch (error) {
            throw new Error(`Zap processing failed: ${error.message}`);
        }
    }

    async createPost() {
        const content = document.getElementById('create-post-content').value.trim();
        if (!content) return;

        const createPostBtn = document.getElementById('create-post-btn');
        const textarea = document.getElementById('create-post-content');
        
        try {
            createPostBtn.disabled = true;
            createPostBtn.textContent = 'Posting...';
            
            const event = {
                kind: 1,
                content: content,
                tags: []
            };

            const publishedEvent = await this.nostrClient.publishEvent(event);
            
            // Add post to appropriate feed immediately
            if (this.knownNanoUsers.has(this.nostrClient.pubkey)) {
                this.nanoPosts.set(publishedEvent.id, publishedEvent);
                if (this.currentFeedTab === 'nano-feed') {
                    // Render at the top of the feed
                    const feed = document.getElementById('nano-feed');
                    const tempDiv = document.createElement('div');
                    await this.renderEvent(publishedEvent, true, tempDiv);
                    feed.insertBefore(tempDiv.firstChild, feed.firstChild);
                    this.feedState.renderedPosts.add(publishedEvent.id);
                }
            } else {
                this.posts.set(publishedEvent.id, publishedEvent);
                if (this.currentFeedTab === 'general-feed') {
                    // Render at the top of the feed
                    const feed = document.getElementById('general-feed');
                    const tempDiv = document.createElement('div');
                    await this.renderEvent(publishedEvent, false, tempDiv);
                    feed.insertBefore(tempDiv.firstChild, feed.firstChild);
                    this.feedState.renderedPosts.add(publishedEvent.id);
                }
            }

            textarea.value = '';
            this.showSuccessMessage('Post created successfully!');
            
            // Trigger a feed refresh after posting
            if (this.currentFeedTab === 'nano-feed') {
                await this.checkForNewNanoPosts();
            } else {
                await this.checkForNewGeneralPosts();
            }
            
        } catch (error) {
            this.showErrorMessage('Failed to create post: ' + error.message);
        } finally {
            createPostBtn.disabled = false;
            createPostBtn.textContent = 'Post';
        }
    }

    async updateProfile(e) {
        e.preventDefault();
        const name = document.getElementById('profile-name').value;
        const about = document.getElementById('profile-about').value;
        const nanoAddress = document.getElementById('profile-nano').value;
        const lightning = document.getElementById('profile-lightning').value;

        // Validate nano address if provided
        if (nanoAddress && !utils.validateNanoAddress(nanoAddress)) {
            alert('Invalid Nano address format');
            return;
        }

        // Format the about section to include nano address if provided
        let formattedAbout = about || '';
        if (nanoAddress) {
            // Remove any existing Nano address
            formattedAbout = formattedAbout.replace(/\nNano: (?:nano|xno)_[^\s]+/, '');
            // Add the new Nano address
            formattedAbout = formattedAbout.trim() + '\nNano: ' + nanoAddress;
        }

        // Standard Nostr metadata format
        const profileData = {
            name: name || '',
            about: formattedAbout,
            lud16: lightning || '',
        };

        try {
            await this.nostrClient.updateProfile(profileData);
            alert('Profile updated successfully!');
            this.loadProfile(); // Refresh the displayed profile
        } catch (error) {
            console.error('Profile update error:', error);
            alert('Failed to update profile. Please try again.');
        }
    }

    setupBackToTop() {
        const backToTopBtn = document.getElementById('back-to-top');
        if (!backToTopBtn) return;
        
        // Initially hide the button
        backToTopBtn.style.display = 'none';
        
        // Show/hide button based on scroll position
        window.addEventListener('scroll', () => {
            if (window.scrollY > 300) {
                backToTopBtn.style.display = 'block';
                backToTopBtn.classList.add('visible');
            } else {
                backToTopBtn.classList.remove('visible');
                setTimeout(() => {
                    if (!backToTopBtn.classList.contains('visible')) {
                        backToTopBtn.style.display = 'none';
                    }
                }, 300); // Match the CSS transition duration
            }
        });

        // Scroll to top when button is clicked
        backToTopBtn.addEventListener('click', () => {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });
    }

    async loginWithNsec() {
        const nsecInput = document.getElementById('nsec-input');
        const nsec = nsecInput.value.trim();
        
        try {
            if (!nsec.startsWith('nsec1')) {
                throw new Error('Invalid nsec format. Must start with nsec1');
            }

            // Convert nsec to private key
            const privateKey = window.NostrTools.nip19.decode(nsec).data;
            
            // Clear any existing posts and state
            this.posts.clear();
            this.nanoPosts.clear();
            this.knownNanoUsers.clear();
            this.clearFeeds();
            
            // Initialize nostr client with private key
            await this.nostrClient.initWithPrivateKey(privateKey);
            
            // Clear the nsec input
            nsecInput.value = '';
            
            // Update UI
            document.getElementById('login-section').style.display = 'none';
            document.getElementById('feed-section').style.display = 'block';
            
            // Set nano feed tab as active
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tab === 'nano-feed-tab');
            });
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.toggle('active', content.id === 'nano-feed-tab');
            });

            // Load everything in order
            await this.loadProfile();
            this.updateRelayList();
            await this.setupFeed(); // This will now properly initialize the nano feed
            
            this.showSuccessMessage('Successfully logged in!');
            
        } catch (error) {
            console.error('Login error:', error);
            this.showErrorMessage('Failed to login: ' + error.message);
        }
    }

    async showReplyForm(eventId) {
        const replyForm = document.getElementById(`reply-form-${eventId}`);
        replyForm.style.display = replyForm.style.display === 'none' ? 'block' : 'none';
    }

    async submitReply(eventId) {
        const replyForm = document.getElementById(`reply-form-${eventId}`);
        const textarea = replyForm.querySelector('textarea');
        const content = textarea.value;
        const submitBtn = replyForm.querySelector('button');
        
        if (!content) return;

        try {
            // Disable button and show posting state
            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending...';
            
            // Create and publish the reply
            const reply = await this.nostrClient.createReply(eventId, content);
            
            // Show success message
            const successMsg = document.createElement('div');
            successMsg.className = 'success-message';
            successMsg.textContent = ' Reply sent!';
            replyForm.appendChild(successMsg);
            
            // Clear textarea and hide form after a short delay
            textarea.value = '';
            setTimeout(() => {
                successMsg.remove();
                replyForm.style.display = 'none';
            }, 2000);

            // Rest of the existing reply rendering code...
            
        } catch (error) {
            console.error('Failed to post reply:', error);
            if (!error.message.includes('Cannot read properties')) {
                alert('Failed to post reply: ' + error.message);
            }
        } finally {
            // Reset button
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send Reply';
        }
    }

    async loadReplies(eventId) {
        const repliesDiv = document.getElementById(`replies-${eventId}`);
        if (!repliesDiv) {
            console.log('Creating replies container for event:', eventId);
            const post = document.getElementById(`post-${eventId}`);
            if (post) {
                const newRepliesDiv = document.createElement('div');
                newRepliesDiv.id = `replies-${eventId}`;
                newRepliesDiv.className = 'replies';
                post.appendChild(newRepliesDiv);
                return this.loadReplies(eventId);
            }
            return;
        }

        try {
            const replies = await this.nostrClient.getReplies(eventId);
            repliesDiv.innerHTML = ''; // Clear existing replies
            
            // Create a Map to store unique replies by ID
            const uniqueReplies = new Map();
            
            // Process each reply, keeping only the latest version
            for (const reply of replies) {
                const existingReply = uniqueReplies.get(reply.id);
                if (!existingReply || existingReply.created_at < reply.created_at) {
                    uniqueReplies.set(reply.id, reply);
                }
            }
            
            // Sort replies by timestamp
            const sortedReplies = Array.from(uniqueReplies.values())
                .sort((a, b) => a.created_at - b.created_at);
            
            for (const reply of sortedReplies) {
                await this.renderReply(reply, repliesDiv);
            }
        
        } catch (error) {
            console.error('Error loading replies:', error);
            repliesDiv.innerHTML = '<p class="error">Error loading replies</p>';
        }
    }

    async repost(eventId) {
        try {
            await this.nostrClient.createRepost(eventId);
            // Immediately update the UI
            const button = document.querySelector(`button[onclick="app.repost('${eventId}')"]`);
            if (button) {
                button.classList.add('active');
                const currentCount = parseInt(button.textContent.match(/\d+/)[0]);
                button.innerHTML = `🔁 Boost (${currentCount + 1})`;
            }
        } catch (error) {
            alert('Failed to repost: ' + error.message);
        }
    }

    async react(eventId, reaction) {
        try {
            await this.nostrClient.createReaction(eventId, reaction);
            // Immediately update the UI
            const button = document.querySelector(`button[onclick="app.react('${eventId}', '+')"]`);
            if (button) {
                button.classList.add('active');
                const currentCount = parseInt(button.textContent.match(/\d+/)[0]);
                button.innerHTML = `❤️ Like (${currentCount + 1})`;
            }
        } catch (error) {
            alert('Failed to react: ' + error.message);
        }
    }

    // Update the hasNanoAddress method to handle profile parsing better
    async hasNanoAddress(pubkey) {
        try {
            const profile = await this.getProfileForPubkey(pubkey);
            if (!profile) return false;
            
            // More thorough check for nano address in various fields
            const findNanoAddress = (text) => {
                if (!text) return false;
                if (typeof text !== 'string') {
                    text = String(text); // Convert to string to ensure includes method exists
                }
                
                // Look for both formats:
                // 1. nano: nano_123...
                // 2. just nano_123...
                const nanoRegex = /(?:nano:\s*)?(?:nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59}/i;
                return nanoRegex.test(text);
            };

            // Check multiple profile fields
            const hasNano = findNanoAddress(profile.nano) || 
                           findNanoAddress(profile.about) || 
                           findNanoAddress(profile.website) ||
                           findNanoAddress(profile.display_name) ||
                           findNanoAddress(profile.name);

            if (hasNano) {
                console.log(`Found Nano address in profile for user ${pubkey}`);
            }

            return hasNano;
        } catch (error) {
            console.error('Error checking nano address:', error);
            return false;
        }
    }

    updateLoadingStatus(message) {
        let statusDiv = document.getElementById('loading-status');
        
        // Remove any existing status div
        if (statusDiv) {
            statusDiv.remove();
        }

        // Create new status div
        statusDiv = document.createElement('div');
        statusDiv.id = 'loading-status';
        statusDiv.className = 'loading-status';
        statusDiv.innerHTML = `
            <div class="spinner-small"></div>
            <span>${message}</span>
        `;

        // Find the current feed and append the status after the last post
        const currentFeed = document.getElementById(this.currentFeedTab);
        if (currentFeed) {
            currentFeed.appendChild(statusDiv);
        }
    }

    // Add helper methods for notifications
    showSuccessMessage(message) {
        this.showNotification(message, 'success');
    }

    showErrorMessage(message) {
        this.showNotification(message, 'error');
    }

    showNotification(message, type) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // Add method to handle feed updates
    async updateFeeds() {
        const now = Date.now();
        if (this.feedState.isLoading || now - this.feedState.lastUpdate < this.feedState.updateInterval) {
            return;
        }

        this.feedState.isLoading = true;
        try {
            if (this.currentFeedTab === 'nano-feed') {
                await this.refreshNanoFeed();
            } else if (this.currentFeedTab === 'general-feed') {
                await this.refreshGeneralFeed();
            }
            this.feedState.lastUpdate = now;
        } finally {
            this.feedState.isLoading = false;
        }
    }

    setupNotificationStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .notification {
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 15px 25px;
                border-radius: 8px;
                color: white;
                z-index: 1000;
                animation: slideIn 0.3s ease;
            }
            
            .notification.success {
                background-color: #4CAF50;
            }
            
            .notification.error {
                background-color: #f44336;
            }
            
            .notification.fade-out {
                opacity: 0;
                transition: opacity 0.3s ease;
            }
            
            @keyframes slideIn {
                from { transform: translateX(100%); }
                to { transform: translateX(0); }
            }
        `;
        document.head.appendChild(style);
    }

    async processNewPost(event, isNanoPost = false) {
        // Skip if we've already processed this event
        const existingEvent = this.feedState.processedEvents.get(event.id);
        if (existingEvent && existingEvent.timestamp >= event.created_at) return;
        
        // Store the event in our processed events map
        this.feedState.processedEvents.set(event.id, {
            timestamp: event.created_at,
            isNano: isNanoPost
        });

        // Check if this is from a known nano user
        if (this.knownNanoUsers.has(event.pubkey)) {
            isNanoPost = true; // Force nano post status for known nano users
        }

        const targetMap = isNanoPost ? this.nanoPosts : this.posts;
        const existingPost = targetMap.get(event.id);
        
        // Only add/update if this is a newer version
        if (!existingPost || existingPost.created_at < event.created_at) {
            targetMap.set(event.id, event);
            
            // If this is the current feed, render it
            if ((isNanoPost && this.currentFeedTab === 'nano-feed') ||
                (!isNanoPost && this.currentFeedTab === 'general-feed')) {
                if (!this.feedState.renderedPosts.has(event.id)) {
                    const isReply = event.tags.some(tag => tag[0] === 'e');
                    if (isReply) {
                        // Handle reply updates
                        const parentId = event.tags.find(tag => tag[0] === 'e')?.[1];
                        if (parentId && document.getElementById(`post-${parentId}`)) {
                            await this.loadReplies(parentId);
                        }
                    } else {
                        // Handle new main posts
                        await this.renderEvent(event, isNanoPost);
                        this.feedState.renderedPosts.add(event.id);
                    }
                }
            }
        }
    }

    async checkNanoUsersForUpdates() {
        if (this.feedState.isLoading) return;
        
        try {
            const since = Math.floor(Date.now() / 1000) - (60 * 60); // Last hour
            const filter = {
                kinds: [1], // Posts
                authors: Array.from(this.knownNanoUsers),
                since: since
            };

            console.log(`Checking ${this.knownNanoUsers.size} nano users for updates...`);

            for (const relay of Object.values(this.nostrClient.relays)) {
                try {
                    const events = await this.nostrClient.queryRelay(relay, filter);
                    let newPosts = 0;
                    let updatedReplies = 0;

                    for (const event of events) {
                        const isReply = event.tags.some(tag => tag[0] === 'e');
                        const existingPost = this.nanoPosts.get(event.id);

                        if (!existingPost || existingPost.created_at < event.created_at) {
                            this.nanoPosts.set(event.id, event);
                            
                            if (isReply) {
                                // If it's a reply, refresh the parent post's replies
                                const parentId = event.tags.find(tag => tag[0] === 'e')?.[1];
                                if (parentId && document.getElementById(`post-${parentId}`)) {
                                    await this.loadReplies(parentId);
                                    updatedReplies++;
                                }
                            } else if (!this.feedState.renderedPosts.has(event.id)) {
                                // If it's a new main post, render it at the top of the feed
                                if (this.currentFeedTab === 'nano-feed') {
                                    const tempDiv = document.createElement('div');
                                    await this.renderEvent(event, true, tempDiv);
                                    const feed = document.getElementById('nano-feed');
                                    feed.insertBefore(tempDiv.firstChild, feed.firstChild);
                                    this.feedState.renderedPosts.add(event.id);
                                }
                                newPosts++;
                            }
                        }
                    }

                    if (newPosts > 0 || updatedReplies > 0) {
                        this.updateLoadingStatus(
                            `Found ${newPosts} new posts and ${updatedReplies} updated replies from Nano users`
                        );
                    }
                } catch (error) {
                    console.error('Error checking relay for nano user updates:', error);
                }
            }
        } catch (error) {
            console.error('Error in checkNanoUsersForUpdates:', error);
        }
    }

    async checkForNewGeneralPosts() {
        if (this.feedState.isLoading) return;
        this.feedState.isLoading = true;
        
        try {
            const feed = document.getElementById('general-feed');
            
            // Get all general posts and sort by timestamp
            let posts = Array.from(this.posts.values())
                .sort((a, b) => b.created_at - a.created_at);
            
            // Get existing post IDs
            const existingPostIds = new Set(
                Array.from(feed.querySelectorAll('.post'))
                    .map(post => post.id.replace('post-', ''))
            );

            // Filter for new posts only
            const newPosts = posts.filter(event => {
                // Skip if already rendered
                if (existingPostIds.has(event.id)) return false;
                // Skip if it's a nano post
                if (this.nanoPosts.has(event.id)) return false;
                // Skip replies
                if (event.tags.some(tag => tag[0] === 'e')) return false;
                // Skip posts from known nano users
                if (this.knownNanoUsers.has(event.pubkey)) return false;
                
                return true;
            });

            if (newPosts.length > 0) {
                this.updateLoadingStatus(`Found ${newPosts.length} new posts...`);
                
                // Prepend new posts to the feed
                for (const event of newPosts) {
                    const tempDiv = document.createElement('div');
                    await this.renderEvent(event, false, tempDiv);
                    feed.insertBefore(tempDiv.firstChild, feed.firstChild);
                    this.feedState.renderedPosts.add(event.id);
                    await this.loadReplies(event.id);
                }
            }

            this.updateLoadingStatus('Monitoring for new posts...');
        } finally {
            this.feedState.isLoading = false;
        }
    }

    async renderReply(reply, container) {
        try {
            const authorProfile = await this.getProfileForPubkey(reply.pubkey);
            const paymentButtons = this.createPaymentButtons(authorProfile, reply.pubkey);
            const reactions = await this.nostrClient.getReactions(reply.id);
            const repostCount = await this.nostrClient.getRepostCount(reply.id);
            const repliesCount = await this.nostrClient.getRepliesCount(reply.id);

            const replyDiv = document.createElement('div');
            replyDiv.className = 'reply';
            replyDiv.id = `reply-${reply.id}`;
            replyDiv.innerHTML = `
                <p class="reply-content">${reply.content}</p>
                <p class="reply-meta">Reply by ${authorProfile?.name || reply.pubkey.slice(0, 8)}... on ${utils.formatDate(reply.created_at)}</p>
                ${paymentButtons}
                <div class="reply-actions">
                    <button class="action-btn reply-btn" onclick="app.showReplyForm('${reply.id}')">
                        💬 Reply (${repliesCount})
                    </button>
                    <button class="action-btn repost-btn ${reactions.reposted ? 'active' : ''}" 
                            onclick="app.repost('${reply.id}')">
                        🔁 Boost (${repostCount})
                    </button>
                    <button class="action-btn like-btn ${reactions.liked ? 'active' : ''}" 
                            onclick="app.react('${reply.id}', '+')">
                        ❤️ Like (${reactions.likes})
                    </button>
                </div>
                <div id="reply-form-${reply.id}" class="reply-form" style="display: none;">
                    <textarea placeholder="Write your reply..."></textarea>
                    <button onclick="app.submitReply('${reply.id}')">Send Reply</button>
                </div>
                <div id="replies-${reply.id}" class="nested-replies"></div>
            `;
            
            container.appendChild(replyDiv);

            // Load nested replies if any exist
            if (repliesCount > 0) {
                await this.loadReplies(reply.id);
            }
        } catch (error) {
            console.error('Error rendering reply:', error);
        }
    }
}

const app = new App();
