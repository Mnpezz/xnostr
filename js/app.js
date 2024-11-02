class App {
    constructor() {
        this.nostrClient = new NostrClient();
        this.posts = new Map(); // Store posts in memory
        this.nanoPosts = new Map(); // Store nano-related posts
        this.knownNanoUsers = new Set(); // Cache users with Nano addresses
        this.currentFeedTab = 'general-feed';
        this.lastLoadedTime = Date.now();
        this.postsPerBatch = 20;
        this.initialLoadLimit = 100;
        this.setupEventListeners();
        this.setupBackToTop();
        document.getElementById('nsec-login-btn')?.addEventListener('click', () => this.loginWithNsec());
    }

    setupEventListeners() {
        document.getElementById('connect-btn').addEventListener('click', () => this.connect());
        document.getElementById('post-btn').addEventListener('click', () => this.createPost());
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
        const currentTime = Date.now();
        if (currentTime - this.lastLoadedTime < 2000) return; // Prevent too frequent loads
        
        this.lastLoadedTime = currentTime;
        const feed = document.getElementById(this.currentFeedTab);
        const posts = this.currentFeedTab === 'nano-feed' ? this.nanoPosts : this.posts;
        
        let count = 0;
        for (const [id, event] of posts) {
            if (!document.getElementById(`post-${id}`)) {
                await this.renderEvent(event);
                count++;
                if (count >= this.postsPerBatch) break;
            }
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

        // Handle feed tab switching
        if (tabId === 'feed-tab') {
            this.currentFeedTab = 'general-feed';
            this.clearFeeds();
            this.refreshGeneralFeed();
        } else if (tabId === 'nano-feed-tab') {
            this.currentFeedTab = 'nano-feed';
            this.clearFeeds();
            this.refreshNanoFeed();
        }
    }

    clearFeeds() {
        document.getElementById('general-feed').innerHTML = '';
        document.getElementById('nano-feed').innerHTML = '';
    }

    async refreshGeneralFeed() {
        const feed = document.getElementById('general-feed');
        feed.innerHTML = '<div class="loading">Loading posts... <div class="spinner"></div></div>';
        
        let posts = Array.from(this.posts.values())
            .sort((a, b) => b.created_at - a.created_at); // Sort by newest first
        
        feed.innerHTML = ''; // Clear loading message
        
        let count = 0;
        for (const event of posts) {
            if (count >= this.initialLoadLimit) break;
            await this.renderEvent(event);
            count++;
        }

        if (count === 0) {
            feed.innerHTML = '<div class="no-posts">No posts found</div>';
        }
    }

    async refreshNanoFeed() {
        const feed = document.getElementById('nano-feed');
        feed.innerHTML = '<div class="loading">Loading Nano-related posts... <div class="spinner"></div></div>';
        
        let posts = Array.from(this.nanoPosts.values())
            .sort((a, b) => b.created_at - a.created_at); // Sort by newest first
        
        feed.innerHTML = ''; // Clear loading message
        
        let count = 0;
        for (const event of posts) {
            if (count >= this.initialLoadLimit) break;
            await this.renderEvent(event, true);
            count++;
        }

        if (count === 0) {
            feed.innerHTML = '<div class="no-posts">Searching for Nano-related posts</div>';
        }
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
            // Extract nano address from about field if it exists
            const about = this.nostrClient.profile.about || '';
            const nanoMatch = about.match(/Nano: ((?:nano|xno)_[^\s]+)/);
            const nanoAddress = nanoMatch ? nanoMatch[1] : '';
            const cleanAbout = about.replace(/\nNano: (?:nano|xno)_[^\s]+/, '').trim();

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

    setupFeed() {
        // Get posts from the last 48 hours
        const since = Math.floor(Date.now() / 1000) - (48 * 60 * 60);
        
        const filters = [
            // Filter for regular posts
            {
                kinds: [1],
                since: since,
                limit: this.initialLoadLimit
            },
            // Filter for posts with #nanocurrency
            {
                kinds: [1],
                '#t': ['nanocurrency'],
                since: since,
                limit: this.initialLoadLimit
            }
        ];
        
        this.nostrClient.subscribe(filters, async event => {
            // Store the post in general feed
            this.posts.set(event.id, event);
            
            // Check if post has #nanocurrency tag
            const hasNanoTag = event.tags.some(tag => 
                tag[0] === 't' && tag[1].toLowerCase() === 'nanocurrency'
            );
            
            // Check if user has Nano address
            const hasNano = await this.nostrClient.hasNanoAddress(event.pubkey);
            
            if (hasNano || hasNanoTag) {
                this.nanoPosts.set(event.id, event);
                if (hasNano) this.knownNanoUsers.add(event.pubkey);
            }

            // Render if in the current feed
            if (this.currentFeedTab === 'general-feed') {
                await this.renderEvent(event);
            } else if (this.currentFeedTab === 'nano-feed' && (hasNano || hasNanoTag)) {
                await this.renderEvent(event, true);
            }
        });

        // Also fetch historical posts from users with Nano addresses
        this.fetchHistoricalPosts();
    }

    async fetchHistoricalPosts() {
        // Get posts from the last month for nano users (increased from 1 week)
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
                            if (profile.about?.includes('nano_') || profile.nano) {
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

                    // Increase timeout for profile gathering
                    setTimeout(() => resolve(profiles), 8000);
                });

                // Then get posts from these users with increased limit
                if (profiles.size > 0) {
                    const postFilter = {
                        kinds: [1],
                        authors: Array.from(profiles),
                        since: since,
                        limit: 1000 // Increased from 500
                    };

                    sub = relay.sub([postFilter]);
                    sub.on('event', event => {
                        if (!this.posts.has(event.id)) {
                            this.posts.set(event.id, event);
                            this.nanoPosts.set(event.id, event); // Add directly to nano posts
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

    async renderEvent(event, isNanoFeed = false) {
        const feedId = isNanoFeed ? 'nano-feed' : 'general-feed';
        
        // Check if this event is already rendered
        if (document.getElementById(`post-${event.id}`)) {
            return;
        }

        const feed = document.getElementById(feedId);
        const div = document.createElement('div');
        div.className = 'post';
        div.id = `post-${event.id}`;
        
        if (event.kind === 1) {
            try {
                const authorProfile = await this.getProfileForPubkey(event.pubkey);
                const paymentButtons = this.createPaymentButtons(authorProfile, event.pubkey);
                
                div.innerHTML = `
                    <p class="content">${event.content}</p>
                    <p class="meta">Posted by ${authorProfile?.name || event.pubkey.slice(0, 8)}... on ${utils.formatDate(event.created_at)}</p>
                    ${paymentButtons}
                `;
            } catch (error) {
                console.error('Error rendering event:', error);
                div.innerHTML = `
                    <p class="content">${event.content}</p>
                    <p class="meta">Posted by ${event.pubkey.slice(0, 8)}... on ${utils.formatDate(event.created_at)}</p>
                `;
            }
        }

        feed.appendChild(div); // Changed from insertBefore to appendChild
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
            // Check if webln is available (only needed for extension method)
            if (!this.nostrClient.privateKey && typeof window.webln === 'undefined') {
                alert('Please install a WebLN provider (like Alby) to send zaps!');
                return;
            }

            // Get the author's profile to find their lightning address
            const authorProfile = await this.getProfileForPubkey(pubkey);
            if (!authorProfile?.lud16) {
                alert('This user has not set up Lightning payments');
                return;
            }

            // If using extension, request webln permissions
            if (!this.nostrClient.privateKey) {
                await window.webln.enable();
            }

            // Prompt for amount
            const amount = prompt('Enter amount in sats:', '1000');
            if (!amount) return;

            const sats = parseInt(amount);
            if (isNaN(sats) || sats <= 0) {
                alert('Please enter a valid amount');
                return;
            }

            try {
                // Create and publish the zap request (only once)
                const zapRequest = await this.nostrClient.createZapRequest(pubkey, sats);
                console.log('Zap request created:', zapRequest);

                const lnurl = authorProfile.lud16;
                console.log('Lightning address:', lnurl);

                // Convert Lightning Address to LNURL endpoint
                let endpoint;
                if (lnurl.includes('@')) {
                    const [name, domain] = lnurl.split('@');
                    endpoint = `https://${domain}/.well-known/lnurlp/${name}`;
                }

                // Fetch the LNURL details with CORS mode
                const response = await fetch(endpoint, {
                    method: 'GET',
                    mode: 'cors',
                    headers: {
                        'Accept': 'application/json'
                    }
                });
                const lnurlData = await response.json();
                console.log('LNURL data:', lnurlData);

                if (!lnurlData.callback) {
                    throw new Error('Invalid LNURL response');
                }

                // Prepare the callback URL with proper encoding
                const nostrJson = encodeURIComponent(JSON.stringify(zapRequest));
                const callbackUrl = `${lnurlData.callback}?amount=${sats * 1000}&nostr=${nostrJson}`;
                
                // Get the invoice with CORS mode
                const callbackResponse = await fetch(callbackUrl, {
                    method: 'GET',
                    mode: 'cors',
                    headers: {
                        'Accept': 'application/json'
                    }
                });
                
                if (!callbackResponse.ok) {
                    throw new Error(`Failed to get invoice: ${callbackResponse.status}`);
                }
                
                const invoiceData = await callbackResponse.json();
                console.log('Invoice data:', invoiceData);

                if (!invoiceData.pr) {
                    throw new Error('No payment request received');
                }

                // Pay the invoice
                if (this.nostrClient.privateKey) {
                    // For mobile/nsec users, show the invoice for manual payment
                    const shouldPay = confirm('Copy invoice to clipboard and pay with your preferred wallet?');
                    if (shouldPay) {
                        await navigator.clipboard.writeText(invoiceData.pr);
                        alert('Invoice copied to clipboard! Please pay with your Lightning wallet.');
                    }
                } else {
                    // For extension users, use webln
                    const paymentResponse = await window.webln.sendPayment(invoiceData.pr);
                    console.log('Payment sent:', paymentResponse);
                    alert('Zap sent successfully!');
                }

            } catch (error) {
                console.error('Zap error:', error);
                if (error.message.includes('CORS')) {
                    alert('Unable to connect to the Lightning service. Please try again later.');
                } else {
                    alert('Failed to send zap: ' + error.message);
                }
            }
        } catch (error) {
            console.error('Zap error:', error);
            alert('Failed to send zap: ' + error.message);
        }
    }

    async createPost() {
        const content = document.getElementById('post-content').value;
        if (!content) return;

        const event = {
            kind: 1,
            content: content,
            tags: []
        };

        try {
            await this.nostrClient.publishEvent(event);
            document.getElementById('post-content').value = '';
        } catch (error) {
            alert('Failed to post: ' + error.message);
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
        
        // Show button when user scrolls down 300px
        window.addEventListener('scroll', () => {
            if (window.scrollY > 300) {
                backToTopBtn.classList.add('visible');
            } else {
                backToTopBtn.classList.remove('visible');
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
            
            // Initialize nostr client with private key
            await this.nostrClient.initWithPrivateKey(privateKey);
            
            // Clear the nsec input
            nsecInput.value = '';
            
            // Continue with normal login flow
            document.getElementById('login-section').style.display = 'none';
            document.getElementById('feed-section').style.display = 'block';
            this.loadProfile();
            this.setupFeed();
            this.updateRelayList();
            
        } catch (error) {
            console.error('Login error:', error);
            alert('Failed to login: ' + error.message);
        }
    }
}

const app = new App();
