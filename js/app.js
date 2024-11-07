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

        this.setupCharacterCounters();
        this.setupDarkMode();
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

    async switchTab(tabId) {
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
            
            // Start loading new posts in background
            this.checkForNewGeneralPosts();
            
            // Only refresh if empty
            if (!generalFeed.querySelector('.post')) {
                this.updateLoadingStatus('Loading general feed...');
                await this.refreshGeneralFeed();
            }
        } else if (tabId === 'nano-feed-tab') {
            this.currentFeedTab = 'nano-feed';
            const nanoFeed = document.getElementById('nano-feed');
            
            // Start loading new posts in background
            this.checkForNewNanoPosts();
            
            // Only refresh if empty
            if (!nanoFeed.querySelector('.post')) {
                this.updateLoadingStatus('Loading Nano-related posts...');
                await this.refreshNanoFeed();
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
            console.log('Refreshing nano feed, current posts:', this.nostrClient.nanoPosts.size);
            
            // Get all posts and sort by timestamp
            let posts = Array.from(this.nostrClient.nanoPosts.values())
                .filter(event => !event.tags.some(tag => tag[0] === 'e')) // Skip replies
                .sort((a, b) => b.created_at - a.created_at); // Newest first
            
            console.log(`Processing ${posts.length} nano posts...`);
            
            // Get existing post IDs and their elements
            const existingPosts = new Map(
                Array.from(feed.querySelectorAll('.post'))
                    .map(post => [post.id.replace('post-', ''), post])
            );

            // Process posts in batches
            const batchSize = 10;
            for (let i = 0; i < posts.length && i < this.initialLoadLimit; i += batchSize) {
                const batch = posts.slice(i, i + batchSize);
                await Promise.all(batch.map(async (event) => {
                    try {
                        const existingPost = existingPosts.get(event.id);
                        if (existingPost) {
                            // Update existing post
                            const tempDiv = document.createElement('div');
                            await this.renderEvent(event, true, tempDiv);
                            if (tempDiv.firstChild) {
                                existingPost.innerHTML = tempDiv.firstChild.innerHTML;
                            }
                        } else {
                            // Add new post at the correct position
                            const tempDiv = document.createElement('div');
                            await this.renderEvent(event, true, tempDiv);
                            
                            // Find the right position to insert
                            let insertBefore = null;
                            for (const post of feed.children) {
                                const postTimestamp = parseInt(post.dataset.timestamp);
                                if (event.created_at > postTimestamp) {
                                    insertBefore = post;
                                    break;
                                }
                            }
                            
                            if (insertBefore) {
                                feed.insertBefore(tempDiv.firstChild, insertBefore);
                            } else {
                                feed.appendChild(tempDiv.firstChild);
                            }
                        }
                        this.feedState.renderedPosts.add(event.id);
                    } catch (error) {
                        console.error('Error rendering post:', error);
                    }
                }));
                
                // Small delay between batches
                if (i + batchSize < posts.length) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }

            if (feed.children.length === 0) {
                feed.innerHTML = '<div class="no-posts">No Nano-related posts found yet...</div>';
            } else {
                this.updateLoadingStatus(`Showing ${feed.children.length} Nano-related posts`);
            }
        } catch (error) {
            console.error('Error in refreshNanoFeed:', error);
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
        const connectBtn = document.getElementById('connect-btn');
        const originalText = connectBtn.textContent;
        
        try {
            // Show loading state
            connectBtn.disabled = true;
            connectBtn.innerHTML = '<span class="spinner"></span> Connecting...';
            
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

            await this.loadProfile();
            await this.setupFeed();
            this.updateRelayList();
            
        } catch (error) {
            console.error('Connection error:', error);
            alert('Failed to connect: ' + error.message);
        } finally {
            // Reset button state
            connectBtn.disabled = false;
            connectBtn.textContent = originalText;
        }
    }

    async loadProfile() {
        console.log('Loading profile data:', this.nostrClient.profile);
        
        const currentProfile = document.getElementById('current-profile');
        currentProfile.innerHTML = '<div class="loading">Loading profile...</div>';

        try {
            // Force a fresh profile fetch
            await this.nostrClient.fetchProfile();
            
            if (this.nostrClient.profile) {
                const profile = this.nostrClient.profile;
                
                // Extract nano address using multiple patterns
                const about = profile.about || '';
                let nanoAddress = '';
                
                const nanoPatterns = [
                    /(?:Nano:\s*)((?:nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59})/i,
                    /((?:nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59})/i
                ];
                
                for (const pattern of nanoPatterns) {
                    const match = about.match(pattern);
                    if (match) {
                        nanoAddress = match[1];
                        break;
                    }
                }
                
                // Clean the about text
                const cleanAbout = about.replace(/\n?(?:Nano:\s*)?(?:nano|xno)_[13][13456789abcdefghijkmnopqrstuwxyz]{59}/i, '').trim();

                // Create profile HTML with banner and picture
                currentProfile.innerHTML = `
                    ${profile.banner ? `
                        <div class="profile-banner">
                            <img src="${profile.banner}" alt="Profile Banner" onerror="this.style.display='none'">
                        </div>
                    ` : ''}
                    <div class="profile-info">
                        <div class="profile-header">
                            ${profile.picture ? `
                                <img src="${profile.picture}" class="profile-picture" alt="Profile Picture" onerror="this.src='default-avatar.png'">
                            ` : '<div class="profile-picture-placeholder"></div>'}
                            <div class="profile-name-info">
                                <h3>${profile.name || 'Unnamed'}</h3>
                                ${profile.nip05 ? `<span class="nip05"> ${profile.nip05}</span>` : ''}
                            </div>
                        </div>
                        <div class="profile-keys">
                            <div class="key-row">
                                <strong>npub:</strong>
                                <span class="address">${window.NostrTools.nip19.npubEncode(this.nostrClient.pubkey)}</span>
                                <button onclick="navigator.clipboard.writeText('${window.NostrTools.nip19.npubEncode(this.nostrClient.pubkey)}')">Copy</button>
                            </div>
                            <div class="key-row">
                                <strong>Pubkey:</strong>
                                <span class="address">${this.nostrClient.pubkey}</span>
                                <button onclick="navigator.clipboard.writeText('${this.nostrClient.pubkey}')">Copy</button>
                            </div>
                        </div>
                        <div class="profile-details">
                            <div class="profile-row">
                                <strong>About:</strong> ${cleanAbout || 'Not set'}
                            </div>
                            <div class="profile-row">
                                <strong>Nano Address:</strong> 
                                ${nanoAddress ? `
                                    <span class="address">${nanoAddress}</span>
                                    <button onclick="navigator.clipboard.writeText('${nanoAddress}')">Copy</button>
                                ` : 'Not set'}
                            </div>
                            <div class="profile-row">
                                <strong>Lightning:</strong>
                                ${profile.lud16 ? `
                                    <span class="address">${profile.lud16}</span>
                                    <button onclick="navigator.clipboard.writeText('${profile.lud16}')">Copy</button>
                                ` : 'Not set'}
                            </div>
                        </div>
                    </div>
                `;

                // Pre-fill form
                document.getElementById('profile-name').value = profile.name || '';
                document.getElementById('profile-about').value = cleanAbout || '';
                document.getElementById('profile-nano').value = nanoAddress || '';
                document.getElementById('profile-lightning').value = profile.lud16 || '';

                // Add to knownNanoUsers if has nano address
                if (nanoAddress) {
                    this.knownNanoUsers.add(this.nostrClient.pubkey);
                }
            } else {
                currentProfile.innerHTML = '<div class="error">No profile data available</div>';
                // Clear form
                document.getElementById('profile-name').value = '';
                document.getElementById('profile-about').value = '';
                document.getElementById('profile-nano').value = '';
                document.getElementById('profile-lightning').value = '';
            }
        } catch (error) {
            console.error('Error loading profile:', error);
            currentProfile.innerHTML = '<div class="error">Error loading profile: ' + error.message + '</div>';
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
        if (confirm('Are you sure you want to remove this relay?')) {
            await this.nostrClient.removeRelay(url);
            this.updateRelayList();
        }
    }

    async fetchUserPosts(pubkey, since) {
        const userPosts = new Map();
        const filter = {
            kinds: [1],
            authors: [pubkey],
            since: since,
            limit: 100  // Increased from 50
        };

        console.log(`Fetching posts for Nano user: ${pubkey}`);
        
        let postsLoaded = 0;
        const maxPosts = 200; // Increased from 100
        
        for (const relay of Object.values(this.nostrClient.relays)) {
            try {
                if (postsLoaded >= maxPosts) break;
                
                console.log(`Querying ${relay.url} for posts from ${pubkey}...`);
                const events = await this.nostrClient.queryRelay(relay, filter);
                console.log(`Got ${events.length} events from ${relay.url}`);
                
                for (const event of events) {
                    if (postsLoaded >= maxPosts) break;
                    
                    // Skip replies for now
                    if (event.tags.some(tag => tag[0] === 'e')) continue;
                    
                    // Only add if not already in userPosts or if this is a newer version
                    const existingPost = userPosts.get(event.id);
                    if (!existingPost || existingPost.created_at < event.created_at) {
                        userPosts.set(event.id, event);
                        postsLoaded++;
                        
                        // Add to nanoPosts Map immediately
                        this.nostrClient.nanoPosts.set(event.id, event);
                        console.log(`Added post ${event.id} to nano feed`);
                    }
                    
                    // Add small delay every 10 posts to keep UI responsive
                    if (postsLoaded % 10 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }
                }
            } catch (error) {
                console.error(`Error fetching user posts from ${relay.url}:`, error);
            }
        }

        const posts = Array.from(userPosts.values())
            .sort((a, b) => b.created_at - a.created_at)
            .slice(0, maxPosts);

        console.log(`Found ${posts.length} unique posts from Nano user ${pubkey}`);
        
        // If we found posts, make sure to refresh the feed
        if (posts.length > 0 && this.currentFeedTab === 'nano-feed') {
            console.log('Refreshing nano feed with new posts...');
            await this.refreshNanoFeed();
        }

        return posts;
    }

    async setupFeed() {
        try {
            // Start both feed initializations in parallel
            const nanoFeedPromise = this.nostrClient.initializeNanoFeed();
            const generalFeedPromise = this.initializeGeneralFeed();

            // Wait for both to complete
            const [nanoPostCount, generalPostCount] = await Promise.all([
                nanoFeedPromise,
                generalFeedPromise
            ]);

            console.log(`Initialized feeds - Nano: ${nanoPostCount} posts, General: ${generalPostCount} posts`);
            
            // Refresh the current feed
            if (this.currentFeedTab === 'nano-feed') {
                await this.refreshNanoFeed();
            } else {
                await this.refreshGeneralFeed();
            }
            
            // Set up subscription for new posts
            const since = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
            const filters = [
                {
                    kinds: [1],
                    since: since,
                    limit: this.initialLoadLimit
                }
            ];

            this.nostrClient.subscribe(filters, async event => {
                try {
                    const isReply = event.tags.some(tag => tag[0] === 'e');
                    if (isReply) return;

                    const hasNano = await this.nostrClient.hasNanoAddress(event.pubkey);
                    if (hasNano) {
                        // Add to nano posts only
                        this.nostrClient.nanoPosts.set(event.id, event);
                        this.knownNanoUsers.add(event.pubkey);
                        
                        if (this.currentFeedTab === 'nano-feed') {
                            await this.renderEvent(event, true);
                        }
                    } else {
                        // Add to general posts only
                        this.posts.set(event.id, event);
                        
                        if (this.currentFeedTab === 'general-feed') {
                            await this.renderEvent(event, false);
                        }
                    }
                } catch (error) {
                    console.error('Error processing event:', error);
                }
            });

        } catch (error) {
            console.error('Error in setupFeed:', error);
            this.showErrorMessage('Error loading feed: ' + error.message);
        }
    }

    // Add new method for general feed initialization
    async initializeGeneralFeed() {
        console.log('Initializing general feed...');
        const twentyFourHoursAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
        
        const filter = {
            kinds: [1],
            since: twentyFourHoursAgo,
            limit: 100
        };

        let postCount = 0;
        for (const relay of Object.values(this.nostrClient.relays)) {
            try {
                const events = await this.nostrClient.queryRelay(relay, filter);
                for (const event of events) {
                    // Skip replies, nano users' posts, and posts with non-English content
                    if (!event.tags.some(tag => tag[0] === 'e') && 
                        !this.knownNanoUsers.has(event.pubkey) &&
                        !this.nanoPosts.has(event.id) &&
                        this.isEnglishContent(event.content)) {
                        this.posts.set(event.id, event);
                        postCount++;
                    }
                }
            } catch (error) {
                console.error('Error fetching general posts:', error);
            }
        }

        console.log(`Found ${postCount} general posts`);
        return postCount;
    }

    // Add helper method to check content language
    isEnglishContent(content) {
        // Simple check for Japanese/Chinese characters
        const hasJapaneseOrChinese = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(content);
        
        // If content has Japanese/Chinese characters, it's not for general feed
        if (hasJapaneseOrChinese) {
            return false;
        }

        // Check if content is mostly English
        const words = content.split(/\s+/);
        const englishWordPattern = /^[a-zA-Z0-9\-'.,!?]+$/;
        const englishWords = words.filter(word => englishWordPattern.test(word));
        
        // If at least 60% of words are English, consider it English content
        return englishWords.length / words.length >= 0.6;
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
        
        // Check if already rendered
        if (document.getElementById(`post-${event.id}`)) {
            return;
        }

        const feed = container || document.getElementById(feedId);
        if (!feed) return;

        // Skip replies - handled by loadReplies
        const isReply = event.tags.some(tag => tag[0] === 'e');
        if (isReply) return;

        // Create main post container
        const postContainer = document.createElement('div');
        postContainer.className = 'post';
        postContainer.id = `post-${event.id}`;
        postContainer.dataset.timestamp = event.created_at.toString();
        
        if (event.kind === 1) {
            try {
                // Use the same profile fetching method as loadProfile
                let authorProfile;
                if (event.pubkey === this.nostrClient.pubkey) {
                    // If it's our own post, use the cached profile
                    authorProfile = this.nostrClient.profile;
                } else {
                    // Otherwise fetch it like we do in loadProfile
                    const filter = {
                        kinds: [0],
                        authors: [event.pubkey],
                        limit: 5
                    };

                    for (const relay of Object.values(this.nostrClient.relays)) {
                        const events = await this.nostrClient.queryRelay(relay, filter);
                        if (events.length > 0) {
                            const profileEvent = events[0];
                            try {
                                authorProfile = JSON.parse(profileEvent.content);
                                break;
                            } catch (error) {
                                console.error('Error parsing profile:', error);
                            }
                        }
                    }
                }

                console.log(`Rendering post with profile:`, authorProfile);
                
                const paymentButtons = this.createPaymentButtons(authorProfile, event.pubkey);
                const reactions = await this.nostrClient.getReactions(event.id);
                const repostCount = await this.nostrClient.getRepostCount(event.id);
                const repliesCount = await this.nostrClient.getRepliesCount(event.id);
                
                // Create the main post content
                const postContent = document.createElement('div');
                postContent.className = 'post-content';
                
                // Create profile header
                const profileHeader = document.createElement('div');
                profileHeader.className = 'post-header';
                profileHeader.innerHTML = `
                    ${authorProfile?.picture ? 
                        `<img src="${authorProfile.picture}" 
                              class="profile-picture" 
                              onerror="this.src='default-avatar.png'">` 
                        : '<div class="profile-picture-placeholder"></div>'
                    }
                    <div class="post-header-info">
                        <span class="author-name">${authorProfile?.name || event.pubkey.slice(0, 8)}...</span>
                        ${authorProfile?.nip05 ? `<span class="nip05">✓ ${authorProfile.nip05}</span>` : ''}
                    </div>
                `;
                postContent.appendChild(profileHeader);

                // Process content for images
                let processedContent = event.content;
                processedContent = processedContent.replace(
                    /(https?:\/\/[^\s<]+?\.(?:jpg|jpeg|gif|png|webp))(?:\s|$)/gi,
                    (match, url) => {
                        return `<img src="${url}" class="post-image" onerror="this.style.display='none'; this.parentElement.textContent='${url}'" /><br>`;
                    }
                );

                // Add post content
                const contentDiv = document.createElement('div');
                contentDiv.innerHTML = `
                    <p class="content">${processedContent}</p>
                    <p class="meta">Posted on ${utils.formatDate(event.created_at)}</p>
                    ${paymentButtons}
                `;
                postContent.appendChild(contentDiv);

                // Add post actions
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'post-actions';
                actionsDiv.innerHTML = `
                    <button class="action-btn reply-btn ${repliesCount > 0 ? 'has-replies' : ''}" 
                            onclick="app.showReplyForm('${event.id}')"
                            data-replies="${repliesCount}">
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
                    <button class="action-btn share-btn" onclick="app.sharePost('${event.id}')">
                        📤 Share
                    </button>
                `;
                postContent.appendChild(actionsDiv);

                // Add all content to post container
                postContainer.appendChild(postContent);

                // Create reply form container
                const replyForm = document.createElement('div');
                replyForm.id = `reply-form-${event.id}`;
                replyForm.className = 'reply-form';
                replyForm.style.display = 'none';
                replyForm.innerHTML = `
                    <textarea placeholder="Write your reply..."></textarea>
                    <button onclick="app.submitReply('${event.id}')">Send Reply</button>
                `;
                postContainer.appendChild(replyForm);

                // Create replies container
                const repliesContainer = document.createElement('div');
                repliesContainer.id = `replies-${event.id}`;
                repliesContainer.className = 'replies';
                postContainer.appendChild(repliesContainer);

                // Add the post to the feed
                feed.appendChild(postContainer);

                // Load replies if there are any
                if (repliesCount > 0) {
                    await this.loadReplies(event.id);
                }

                return postContainer;
            } catch (error) {
                console.error('Error rendering event:', error);
                postContainer.innerHTML = `
                    <p class="content">${event.content}</p>
                    <p class="meta">Posted by ${event.pubkey.slice(0, 8)}... on ${utils.formatDate(event.created_at)}</p>
                `;
                feed.appendChild(postContainer);
                return postContainer;
            }
        }
    }

    createPaymentButtons(profile, pubkey) {
        if (!profile) return '';

        const buttons = [];
        
        // Check for nano address in multiple places
        const nanoAddress = 
            profile.nano_address || 
            this.nostrClient.findNanoAddress(profile.about) ||
            this.nostrClient.findNanoAddress(profile.nano) ||
            this.nostrClient.findNanoAddress(profile.website);

        if (nanoAddress) {
            // Cache the nano address in the profile
            profile.nano_address = nanoAddress;
            this.nostrClient.profileCache.set(pubkey, profile);
            
            buttons.push(`
                <button class="payment-btn nano-tip" onclick="app.sendNanoTip('${nanoAddress}', '${profile.name || 'User'}')">
                    💎 Tip Nano
                </button>
            `);
        }

        if (profile.lud16) {
            buttons.push(`
                <button class="payment-btn zap-tip lightning-tip" onclick="app.sendZap('${pubkey}')">
                    ⚡ Zap
                </button>
            `);
        }

        return buttons.length ? `<div class="payment-buttons">${buttons.join('')}</div>` : '';
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
        const submitButton = e.target.querySelector('button[type="submit"]');
        const originalText = submitButton.textContent;

        try {
            // Show loading state
            submitButton.disabled = true;
            submitButton.textContent = 'Updating...';

            const name = document.getElementById('profile-name').value.trim();
            const about = document.getElementById('profile-about').value.trim();
            const nanoAddress = document.getElementById('profile-nano').value.trim();
            const lightning = document.getElementById('profile-lightning').value.trim();

            // Validate nano address if provided
            if (nanoAddress && !utils.validateNanoAddress(nanoAddress)) {
                throw new Error('Invalid Nano address format');
            }

            // Preserve existing profile data
            const currentProfile = { ...this.nostrClient.profile };

            // Format the about section to include nano address if provided
            let formattedAbout = about || '';
            if (nanoAddress) {
                // Remove any existing Nano address
                formattedAbout = formattedAbout.replace(/\n?(?:Nano:\s*)?(?:nano|xno)_[^\s]+/, '');
                // Add the new Nano address
                formattedAbout = (formattedAbout.trim() + '\nNano: ' + nanoAddress).trim();
            }

            // Standard Nostr metadata format
            const profileData = {
                ...currentProfile, // Preserve existing fields
                name: name || '',
                about: formattedAbout,
                lud16: lightning || '',
                // Preserve other fields if they exist
                picture: currentProfile.picture || '',
                banner: currentProfile.banner || '',
                nip05: currentProfile.nip05 || '',
            };

            console.log('Updating profile with:', profileData);

            await this.nostrClient.updateProfile(profileData);
            this.showSuccessMessage('Profile updated successfully!');
            
            // Force a fresh profile fetch after update
            await this.nostrClient.fetchProfile();
            await this.loadProfile(); // Refresh the displayed profile

            // Update nano user status
            if (nanoAddress) {
                this.knownNanoUsers.add(this.nostrClient.pubkey);
            }

        } catch (error) {
            console.error('Profile update error:', error);
            this.showErrorMessage('Failed to update profile: ' + error.message);
        } finally {
            // Reset button state
            submitButton.disabled = false;
            submitButton.textContent = originalText;
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
        const loginBtn = document.getElementById('nsec-login-btn');
        const originalText = loginBtn.textContent;
        const nsec = nsecInput.value.trim();
        
        try {
            // Show loading state
            loginBtn.disabled = true;
            loginBtn.innerHTML = '<span class="spinner"></span> Logging in...';
            
            if (!nsec.startsWith('nsec1')) {
                throw new Error('Invalid nsec format. Must start with nsec1');
            }

            // Convert nsec to private key
            const privateKey = window.NostrTools.nip19.decode(nsec).data;
            
            // Initialize nostr client with private key
            await this.nostrClient.initWithPrivateKey(privateKey);
            
            // Clear the nsec input for security
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

            // Load profile and setup feed
            await this.loadProfile();
            await this.setupFeed();
            this.updateRelayList();
            
            // Start searching for nano users
            setTimeout(() => {
                this.searchForMoreNanoUsers();
            }, 5000);

            // Set up periodic checks
            setInterval(() => {
                if (this.currentFeedTab === 'nano-feed') {
                    this.checkNanoUsersForUpdates();
                    this.searchForMoreNanoUsers();
                }
            }, 45000);

            this.showSuccessMessage('Successfully logged in!');
            
        } catch (error) {
            console.error('Login error:', error);
            this.showErrorMessage('Failed to login: ' + error.message);
        } finally {
            // Reset button state
            loginBtn.disabled = false;
            loginBtn.textContent = originalText;
        }
    }

    async showReplyForm(eventId) {
        const replyFormContainer = document.getElementById(`reply-form-${eventId}`);
        if (!replyFormContainer) return;
        
        // Toggle visibility
        const isVisible = replyFormContainer.style.display === 'block';
        replyFormContainer.style.display = isVisible ? 'none' : 'block';
        
        // Load replies when showing the form
        if (!isVisible) {
            const repliesContainer = document.getElementById(`replies-${eventId}`);
            if (repliesContainer) {
                try {
                    await this.loadReplies(eventId);
                } catch (error) {
                    console.error('Error loading replies:', error);
                }
            }
        }
    }

    async loadReplies(eventId) {
        console.log(`Loading replies for event ${eventId}`);
        const repliesDiv = document.getElementById(`replies-${eventId}`);
        const replyBtn = document.querySelector(`button[onclick="app.showReplyForm('${eventId}')"]`);
        
        if (!repliesDiv) {
            console.error(`No replies div found for event ${eventId}`);
            return;
        }

        try {
            // Add loading states
            repliesDiv.classList.add('loading');
            if (replyBtn) {
                replyBtn.classList.add('loading');
                replyBtn.innerHTML = '💬 Loading...';
            }

            // Get replies from all relays
            const replies = await this.nostrClient.getReplies(eventId);
            console.log(`Got ${replies.length} replies for event ${eventId}`);

            // Add minimum loading time of 1 second for better UX
            await new Promise(resolve => setTimeout(resolve, 1000));

            if (replies.length > 0) {
                // Clear existing replies
                repliesDiv.innerHTML = '';
                
                // Sort replies by timestamp
                const sortedReplies = replies.sort((a, b) => a.created_at - b.created_at);
                
                // Create a map to track rendered replies
                const renderedReplies = new Set();
                
                // Render replies in smaller batches for smoother loading
                const batchSize = 3;
                for (let i = 0; i < sortedReplies.length; i += batchSize) {
                    const batch = sortedReplies.slice(i, i + batchSize);
                    
                    await Promise.all(batch.map(async reply => {
                        // Skip if already rendered
                        if (renderedReplies.has(reply.id)) return;
                        
                        // Verify this is a direct reply
                        const isDirectReply = reply.tags.some(tag => 
                            tag[0] === 'e' && tag[1] === eventId
                        );
                        
                        if (isDirectReply) {
                            try {
                                await this.renderReply(reply, repliesDiv);
                                renderedReplies.add(reply.id);
                                repliesDiv.classList.add('has-replies');
                            } catch (error) {
                                console.error(`Error rendering reply ${reply.id}:`, error);
                            }
                        }
                    }));

                    // Small delay between batches for smoother loading
                    if (i + batchSize < sortedReplies.length) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }
            }

            // Update button state after all replies are loaded
            if (replyBtn) {
                replyBtn.classList.remove('loading');
                replyBtn.innerHTML = `💬 Reply (${replies.length})`;
                replyBtn.setAttribute('data-replies', replies.length.toString());
            }
            
            // Keep loading spinner a bit longer for better UX
            await new Promise(resolve => setTimeout(resolve, 500));
            repliesDiv.classList.remove('loading');

        } catch (error) {
            console.error(`Error loading replies for ${eventId}:`, error);
            // Reset loading states on error
            repliesDiv.classList.remove('loading');
            if (replyBtn) {
                replyBtn.classList.remove('loading');
                replyBtn.innerHTML = '💬 Reply (0)';
            }
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
        console.log(`Checking ${this.knownNanoUsers.size} nano users for updates...`);
        const since = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
        
        for (const pubkey of this.knownNanoUsers) {
            try {
                console.log(`Checking for updates from nano user: ${pubkey}`);
                const posts = await this.fetchUserPosts(pubkey, since);
                
                if (posts.length > 0) {
                    console.log(`Found ${posts.length} new posts from ${pubkey}`);
                    // Force a feed refresh if we're on the nano feed
                    if (this.currentFeedTab === 'nano-feed') {
                        await this.refreshNanoFeed();
                    }
                }
            } catch (error) {
                console.error(`Error checking updates for ${pubkey}:`, error);
            }
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
            const authorProfile = await this.nostrClient.getProfileForPubkey(reply.pubkey);
            const paymentButtons = this.createPaymentButtons(authorProfile, reply.pubkey);
            const reactions = await this.nostrClient.getReactions(reply.id);
            const repostCount = await this.nostrClient.getRepostCount(reply.id);
            const repliesCount = await this.nostrClient.getRepliesCount(reply.id);

            const replyDiv = document.createElement('div');
            replyDiv.className = 'reply';
            replyDiv.id = `reply-${reply.id}`;
            replyDiv.innerHTML = `
                <div class="reply-header">
                    ${authorProfile?.picture ? `
                        <img src="${this.nostrClient.sanitizeImageUrl(authorProfile.picture)}" 
                             class="profile-picture" 
                             onerror="this.src='default-avatar.png'; console.log('Failed to load image for ${reply.pubkey}');">` 
                        : '<div class="profile-picture-placeholder"></div>'
                    }
                    <div class="reply-header-info">
                        <span class="author-name">${authorProfile?.name || reply.pubkey.slice(0, 8)}...</span>
                        ${authorProfile?.nip05 ? `<span class="nip05">✓ ${authorProfile.nip05}</span>` : ''}
                    </div>
                </div>
                <p class="reply-content">${reply.content}</p>
                <p class="reply-meta">Posted on ${utils.formatDate(reply.created_at)}</p>
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

    setupCharacterCounters() {
        const createPostContent = document.getElementById('create-post-content');
        if (createPostContent) {
            createPostContent.addEventListener('input', (e) => {
                const count = e.target.value.length;
                const maxLength = 280;
                const remaining = maxLength - count;
                
                let counter = e.target.parentElement.querySelector('.char-counter');
                if (!counter) {
                    counter = document.createElement('div');
                    counter.className = 'char-counter';
                    e.target.parentElement.appendChild(counter);
                }
                
                counter.textContent = `${remaining} characters remaining`;
                counter.style.color = remaining < 20 ? '#dc3545' : '#666';
            });
        }
    }

    async sharePost(eventId) {
        try {
            const nostrUrl = `nostr:${eventId}`;
            if (navigator.share) {
                await navigator.share({
                    title: 'Share Post',
                    text: 'Check out this post on Nostr',
                    url: nostrUrl
                });
            } else {
                await navigator.clipboard.writeText(nostrUrl);
                this.showSuccessMessage('Post URL copied to clipboard!');
            }
        } catch (error) {
            console.error('Error sharing post:', error);
        }
    }

    setupDarkMode() {
        const darkMode = localStorage.getItem('darkMode') === 'true';
        if (darkMode) {
            document.body.classList.add('dark-mode');
        }
        
        // Add button to settings tab
        const settingsTab = document.getElementById('settings-tab');
        const darkModeToggle = document.createElement('div');
        darkModeToggle.className = 'dark-mode-toggle';
        darkModeToggle.innerHTML = `
            <label class="switch">
                <input type="checkbox" ${darkMode ? 'checked' : ''}>
                <span class="slider"></span>
            </label>
            <span>Dark Mode</span>
        `;
        
        darkModeToggle.querySelector('input').addEventListener('change', (e) => {
            document.body.classList.toggle('dark-mode', e.target.checked);
            localStorage.setItem('darkMode', e.target.checked);
        });
        
        settingsTab.appendChild(darkModeToggle);
    }

    async addUserToNanoFeed(pubkey, since) {
        console.log(`Fetching posts for nano user: ${pubkey}`);
        const filter = {
            kinds: [1],
            authors: [pubkey],
            since: since,
            limit: 100
        };

        let postsAdded = 0;
        for (const relay of Object.values(this.nostrClient.relays)) {
            try {
                const events = await this.nostrClient.queryRelay(relay, filter);
                console.log(`Found ${events.length} posts from ${relay.url}`);
                
                for (const event of events) {
                    // Skip replies
                    if (!event.tags.some(tag => tag[0] === 'e')) {
                        this.nostrClient.nanoPosts.set(event.id, event);
                        postsAdded++;
                        console.log(`Added post ${event.id} to nano feed (${postsAdded} total)`);
                    }
                }
            } catch (error) {
                console.error('Error fetching posts:', error);
            }
        }
        
        console.log(`Added ${postsAdded} posts from nano user ${pubkey}`);
        
        // Force a feed refresh if we're on the nano feed
        if (postsAdded > 0 && this.currentFeedTab === 'nano-feed') {
            console.log('Triggering nano feed refresh...');
            await this.refreshNanoFeed();
        }
        
        return postsAdded;
    }
}

const app = new App();
