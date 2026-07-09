// App logic migrated to Firebase Auth + Firestore with server-side queries, pagination and better UX

const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1574943320219-553eb213f72d?auto=format&fit=crop&w=500&q=80";

const landingPage   = document.getElementById('landingPage');
const dashboardApp  = document.getElementById('dashboardApp');
const navMenu       = document.getElementById('navMenu');
const authModal     = document.getElementById('authModal');
const loginForm     = document.getElementById('loginForm');
const registerForm  = document.getElementById('registerForm');
const resetForm     = document.getElementById('resetForm');

const cropContainer = document.getElementById('cropCardsContainer');
const resultCountEl = document.getElementById('resultCount');

// Pagination & query state
let pageSize = 8;
let lastVisible = null; // last document snapshot for pagination
let isLoading = false;
let currentQueryOptions = { searchTerm: '', location: 'All' };

function triggerToast(message) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

function openModal(tab) {
    authModal.classList.add('active');
    switchTab(tab);
}

function closeModal() {
    authModal.classList.remove('active');
    showAuthTabs();
    switchTab('login');
}

function switchTab(tab) {
    const loginF    = document.getElementById('loginForm');
    const registerF = document.getElementById('registerForm');
    const resetF    = document.getElementById('resetForm');
    const tabLogin  = document.getElementById('tabLogin');
    const tabReg    = document.getElementById('tabRegister');

    loginF.classList.remove('active');
    registerF.classList.remove('active');
    resetF.classList.remove('active');
    tabLogin.classList.remove('active');
    tabReg.classList.remove('active');

    if (tab === 'login') {
        loginF.classList.add('active');
        tabLogin.classList.add('active');
    } else if (tab === 'register') {
        registerF.classList.add('active');
        tabReg.classList.add('active');
    } else if (tab === 'reset') {
        resetF.classList.add('active');
    }
}

function scrollToSection(id) {
    const target = document.getElementById(id);
    if (!target) return;
    const navHeight = document.querySelector('.navbar').offsetHeight;
    const top = target.getBoundingClientRect().top + window.pageYOffset - navHeight;
    window.scrollTo({ top, behavior: 'smooth' });
}
window.scrollToSection = scrollToSection;

const STATIC_PAGES = {
    privacy: {
        title: 'Privacy Policy',
        html: `
            <h2>Privacy Policy</h2>
            <p>AgriMarket SL collects the information you provide when creating an account (name, email) and when posting a listing (crop details, price, phone number), in order to operate the marketplace.</p>
            <h3>How we use your data</h3>
            <p>Listing details, including your phone number, are shown publicly to signed-in buyers so they can contact you directly. Account information is used only to operate and secure your account.</p>
            <h3>Your choices</h3>
            <p>You can update or remove your listings at any time, and you can request account deletion by contacting support.</p>
        `
    },
    support: {
        title: 'Support',
        html: `
            <h2>Support</h2>
            <p>Need help with your account or a listing? Here are the most common questions.</p>
            <h3>I can't sign in</h3>
            <p>Use the "Forgot?" link on the sign-in form to reset your password. If issues continue, reach out through the contact section below.</p>
            <h3>How do I list a crop?</h3>
            <p>Sign in, then use the dashboard to add your crop, price, and location so buyers can find and call you.</p>
            <h3>Still stuck?</h3>
            <p>Message us using the contact form on the homepage, or email support@agrimarketsl.com.</p>
        `
    }
};

function showPage(pageKey) {
    const page = STATIC_PAGES[pageKey];
    if (!page) return;
    document.getElementById('landingPage').style.display = 'none';
    dashboardApp.style.display = 'none';
    document.getElementById('staticPageContainer').style.display = 'block';
    document.getElementById('staticContent').innerHTML = page.html;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.showPage = showPage;

function showDashboard() {
    document.getElementById('staticPageContainer').style.display = 'none';
    const auth = window.firebaseAuth;
    if (auth && auth.currentUser) {
        dashboardApp.style.display = 'block';
    } else {
        document.getElementById('landingPage').style.display = 'block';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.showDashboard = showDashboard;

function hideAuthTabs() {
    document.getElementById('authTabsContainer').style.display = 'none';
}

function showAuthTabs() {
    document.getElementById('authTabsContainer').style.display = 'flex';
}

// Wait for Firebase module script to expose helpers on window
function waitForFirebase(timeout = 10000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        (function check() {
            if (window.firebaseAuth && window.firebaseDb && window.authFns && window.dbFns) return resolve();
            if (Date.now() - start > timeout) return reject(new Error('Firebase did not initialize in time'));
            setTimeout(check, 100);
        })();
    });
}

function mapFirebaseError(err) {
    if (!err) return 'An unknown error occurred.';
    // Firebase errors often have a code property (auth/xxx). Firestore permission issues may be strings.
    const code = err.code || (err && err.message) || '';
    if (typeof code === 'string') {
        if (code.includes('auth/invalid-email')) return 'The email address is not valid.';
        if (code.includes('auth/email-already-in-use')) return 'This email is already registered.';
        if (code.includes('auth/wrong-password')) return 'Incorrect password.';
        if (code.includes('auth/user-not-found')) return 'No account found for that email.';
        if (code.includes('auth/weak-password')) return 'Password is too weak (minimum 6 characters).';
        if (code.includes('auth/too-many-requests')) return 'Too many attempts. Try again later.';
        if (code.includes('permission-denied')) return 'Access denied. You do not have permission to view this data.';
        if (code.includes('not-found')) return 'Requested data was not found.';
        if (code.includes('network-request-failed')) return 'Network error. Check your connection.';
    }
    // Fallback to err.message when available
    return err.message || String(err);
}

function setLoading(state) {
    isLoading = state;
    if (state) {
        // simple inline loader — keeps UX improvements minimal and self-contained
        cropContainer.innerHTML = '<div class="loader" aria-busy="true" style="grid-column:1/-1;padding:2rem;text-align:center;">Loading listings...</div>';
        resultCountEl.textContent = 'Loading...';
    }
}

function renderEmptyState() {
    cropContainer.innerHTML = `
      <div style="grid-column:1/-1;padding:2rem;text-align:center;">
        <h3>No listings found</h3>
        <p class="text-muted">We couldn't find any market listings matching your search. Try different keywords or select another region.</p>
      </div>
    `;
    resultCountEl.textContent = '0 listings';
}

function renderListings(listings, append = false) {
    if (!append) cropContainer.innerHTML = '';

    if (!listings || listings.length === 0) {
        if (!append) renderEmptyState();
        return;
    }

    resultCountEl.textContent = `${listings.length} listing${listings.length !== 1 ? 's' : ''}`;

    listings.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <img src="${item.image_url || FALLBACK_IMAGE}" alt="${item.name}" class="card-img" onerror="this.src='${FALLBACK_IMAGE}'">
            <div class="card-content">
                <div class="badge-row">
                    ${item.location ? `<span class="badge badge-location"><i class="fa-solid fa-location-dot"></i> ${item.location}</span>` : ''}
                    ${item.category ? `<span class="badge badge-category">${item.category}</span>` : ''}
                </div>
                <h3 class="card-title">${item.name}</h3>
                <span class="card-price">SLLE ${Number(item.price || 0).toLocaleString()}</span>
                <div class="card-meta">
                    ${item.farmer_name ? `<p><i class="fa-solid fa-user"></i> ${item.farmer_name}</p>` : ''}
                    ${item.phone ? `<p><i class="fa-solid fa-phone"></i> <a href="tel:${item.phone}">${item.phone}</a></p>` : ''}
                </div>
                ${item.phone ? `<button class="btn-contact" onclick="window.location.href='tel:${item.phone}'"><i class="fa-solid fa-phone"></i> Contact Farmer</button>` : ''}
            </div>
        `;
        cropContainer.appendChild(card);
    });
}

function renderPaginationControls(hasMore = false) {
    // Remove old controls
    const old = document.getElementById('paginationControls');
    if (old) old.remove();

    const wrapper = document.createElement('div');
    wrapper.id = 'paginationControls';
    wrapper.style.gridColumn = '1/-1';
    wrapper.style.display = 'flex';
    wrapper.style.justifyContent = 'center';
    wrapper.style.marginTop = '1rem';

    const loadMore = document.createElement('button');
    loadMore.className = 'btn-outline';
    loadMore.textContent = 'Load more';
    loadMore.disabled = !hasMore;
    loadMore.addEventListener('click', async () => {
        await loadMoreCrops();
    });

    wrapper.appendChild(loadMore);
    cropContainer.parentNode.appendChild(wrapper);
}

// Server-side Firestore fetch with pagination. Supports location filter and prefix-search on name_lower
async function fetchCropsFromFirestore({ searchTerm = '', location = 'All', page = 1, pageSizeLocal = pageSize, startAfterDoc = null } = {}) {
    const db = window.firebaseDb;
    const { collection, getDocs, query, where, orderBy, limit, startAfter } = window.dbFns;

    try {
        const cropsCol = collection(db, 'crops');
        let q = null;

        // Build query parts
        const constraints = [];

        if (location && location !== 'All') {
            constraints.push(where('location', '==', location));
        }

        // For server-side search we attempt a prefix search on a lowercase field 'name_lower'.
        // This requires that documents include a 'name_lower' string field.
        const normalizedSearch = (searchTerm || '').trim().toLowerCase();
        if (normalizedSearch) {
            // Firestore prefix range trick
            const end = normalizedSearch + '\\uf8ff';
            constraints.push(where('name_lower', '>=', normalizedSearch));
            constraints.push(where('name_lower', '<=', end));
        }

        // If constraints are present, compose a query. We'll order by name_lower if searching, otherwise by created_at or name.
        if (normalizedSearch) {
            constraints.push(orderBy('name_lower'));
        } else {
            // If collection has a created_at field, that would be better. Fallback to name ordering.
            try {
                constraints.push(orderBy('created_at', 'desc'));
            } catch (e) {
                constraints.push(orderBy('name'));
            }
        }

        // Pagination
        constraints.push(limit(pageSizeLocal));
        if (startAfterDoc) {
            constraints.push(startAfter(startAfterDoc));
        }

        q = query(cropsCol, ...constraints);

        const snap = await getDocs(q);
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data(), _snap: d }));
        const hasMore = docs.length === pageSizeLocal;
        // Save lastVisible for next page
        lastVisible = docs.length ? docs[docs.length - 1]._snap : null;

        // Strip _snap before returning
        const clean = docs.map(({ _snap, ...rest }) => rest);
        return { data: clean, hasMore };
    } catch (err) {
        // If the server-side search failed because documents lack 'name_lower', fallback to a simple unfiltered read
        const msg = String(err && err.message ? err.message : err);
        if (msg.includes('Field') || msg.includes('name_lower') || msg.includes('invalid-argument')) {
            console.warn('Prefix search failed, falling back to client-side search. Error:', err);
            // get all (or location-filtered) docs then filter client-side
            try {
                const cropsCol = collection(db, 'crops');
                let q2 = null;
                const parts = [];
                if (location && location !== 'All') parts.push(where('location', '==', location));
                parts.push(limit(pageSizeLocal));
                if (startAfterDoc) parts.push(startAfter(startAfterDoc));
                // Order by name for consistent results
                parts.push(orderBy('name'));
                q2 = query(cropsCol, ...parts);
                const snap = await getDocs(q2);
                const docs = snap.docs.map((d) => ({ id: d.id, ...d.data(), _snap: d }));
                lastVisible = docs.length ? docs[docs.length - 1]._snap : null;
                const clean = docs.map(({ _snap, ...rest }) => rest);
                return { data: clean, hasMore: clean.length === pageSizeLocal };
            } catch (err2) {
                throw err2; // let outer handler map error
            }
        }

        throw err; // rethrow for outer handler
    }
}

async function loadInitialCrops() {
    setLoading(true);
    lastVisible = null;
    try {
        const { data, hasMore } = await fetchCropsFromFirestore({ searchTerm: currentQueryOptions.searchTerm, location: currentQueryOptions.location, pageSizeLocal: pageSize, startAfterDoc: null });
        setLoading(false);
        renderListings(data || [], false);
        renderPaginationControls(hasMore);
    } catch (err) {
        setLoading(false);
        console.error('Failed to load crops', err);
        triggerToast(mapFirebaseError(err));
        renderEmptyState();
    }
}

async function loadMoreCrops() {
    if (!lastVisible) {
        triggerToast('No more listings');
        return;
    }
    setLoading(true);
    try {
        const { data, hasMore } = await fetchCropsFromFirestore({ searchTerm: currentQueryOptions.searchTerm, location: currentQueryOptions.location, pageSizeLocal: pageSize, startAfterDoc: lastVisible });
        setLoading(false);
        if (data && data.length) renderListings(data, true);
        renderPaginationControls(hasMore);
    } catch (err) {
        setLoading(false);
        console.error('Failed to load more crops', err);
        triggerToast(mapFirebaseError(err));
    }
}

async function applyFilters() {
    // Called when user submits search/filter. Reset pagination and load from server with filters
    const searchTerm = document.getElementById('searchInput').value.trim();
    const location   = document.getElementById('locationFilter').value;
    currentQueryOptions = { searchTerm, location };
    await loadInitialCrops();
}

async function initApp() {
    try {
        await waitForFirebase();
    } catch (err) {
        console.error(err);
        triggerToast('Firebase failed to initialize.');
        return;
    }

    const auth = window.firebaseAuth;
    const db = window.firebaseDb;
    const { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail } = window.authFns;
    const { collection, getDocs, doc, setDoc } = window.dbFns;

    // Auth state observer
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // User is signed in
            landingPage.style.display = 'none';
            dashboardApp.style.display = 'block';

            navMenu.innerHTML = `
                <span class="nav-link"><i class="fa-solid fa-user-check"></i> ${user.email}</span>
                <button id="navLogoutBtn" class="btn-outline"><i class="fa-solid fa-right-from-bracket"></i> Log Out</button>
            `;
            document.getElementById('navLogoutBtn').addEventListener('click', async () => {
                try {
                    await signOut(auth);
                    triggerToast('You have been securely logged out.');
                } catch (err) {
                    console.error('Sign out failed', err);
                    triggerToast(mapFirebaseError(err));
                }
            });

            // Load initial crops for signed-in user
            await loadInitialCrops();
        } else {
            // No user
            landingPage.style.display = 'block';
            dashboardApp.style.display = 'none';
            navMenu.innerHTML = `<button id="navLoginBtn" class="btn-outline">Log In</button>`;
            document.getElementById('navLoginBtn').addEventListener('click', () => openModal('login'));
        }
    });

    // Register
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name     = document.getElementById('regName').value;
        const email    = document.getElementById('regEmail').value;
        const password = document.getElementById('regPassword').value;

        try {
            const cred = await createUserWithEmailAndPassword(auth, email, password);
            // Save user profile...

            landingPage.style.display = "none";
            dashboardApp.style.display = "block";
            await loadInitialCrops();
            const uid = cred.user.uid;
            // create a user profile document
            try {
                await setDoc(doc(db, 'users', uid), { full_name: name, email, created_at: new Date().toISOString() });
            } catch (err) {
                console.warn('Failed to write user profile', err);
            }

            closeModal();
            triggerToast('Account created! Please check your email to confirm (if required by your Firebase settings).');
        } catch (err) {
            console.error('Sign up failed', err);
            triggerToast(mapFirebaseError(err));
        }
    });

    // Login
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email    = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;

        try {
            await signInWithEmailAndPassword(auth, email, password);
            landingPage.style.display = "none";
            dashboardApp.style.display = "block";
            await loadInitialCrops();
            closeModal();
        } catch (err) {
            console.error('Sign in failed', err);
            triggerToast(mapFirebaseError(err));
        }
    });

    // Password reset (send reset email)
    resetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('resetEmail').value;
        try {
            await sendPasswordResetEmail(auth, email);
            triggerToast('Password reset email sent. Check your inbox.');
            showAuthTabs();
            switchTab('login');
            closeModal();
        } catch (err) {
            console.error('Password reset failed', err);
            triggerToast(mapFirebaseError(err));
        }
    });

    // UI interactions
    document.getElementById('searchBtn')?.addEventListener('click', applyFilters);
    document.getElementById('searchInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyFilters(); });
    document.getElementById('closeModal')?.addEventListener('click', closeModal);
    authModal?.addEventListener('click', (e) => { if (e.target === authModal) closeModal(); });
    document.getElementById('tabLogin')?.addEventListener('click', () => { showAuthTabs(); switchTab('login'); });
    document.getElementById('tabRegister')?.addEventListener('click', () => { showAuthTabs(); switchTab('register'); });
    document.getElementById('forgotPasswordLink')?.addEventListener('click', (e) => { e.preventDefault(); hideAuthTabs(); switchTab('reset'); });
    document.getElementById('backToLoginLink')?.addEventListener('click', (e) => { e.preventDefault(); showAuthTabs(); switchTab('login'); });
    document.getElementById('btnStartLogin')?.addEventListener('click', () => openModal('login'));
    document.getElementById('btnStartRegister')?.addEventListener('click', () => openModal('register'));

    const ctaLoginBtn = document.getElementById('btnCtaLogin');
    const ctaRegisterBtn = document.getElementById('btnCtaRegister');
    if (ctaLoginBtn) ctaLoginBtn.addEventListener('click', () => openModal('login'));
    if (ctaRegisterBtn) ctaRegisterBtn.addEventListener('click', () => openModal('register'));

    // Mobile nav toggle
    const navToggle = document.getElementById('navToggle');
    const navLinksEl = document.getElementById('navLinks');
    if (navToggle && navLinksEl) {
        navToggle.addEventListener('click', () => {
            const isOpen = navLinksEl.classList.toggle('open');
            navToggle.setAttribute('aria-expanded', String(isOpen));
        });
    }

    // Smooth-scroll in-page nav links (Home/About/Services/How It Works/Contact)
    document.querySelectorAll('.nav-page-link').forEach((link) => {
        link.addEventListener('click', (e) => {
            const href = link.getAttribute('href') || '';
            if (href.startsWith('#')) {
                e.preventDefault();
                const targetId = href.slice(1);
                // If a static page is currently showing, return to the dashboard/landing first
                if (document.getElementById('staticPageContainer').style.display !== 'none') {
                    showDashboard();
                }
                scrollToSection(targetId);
            }
            if (navLinksEl && navLinksEl.classList.contains('open')) {
                navLinksEl.classList.remove('open');
                navToggle.setAttribute('aria-expanded', 'false');
            }
        });
    });

    // Contact form (client-side only — no backend endpoint configured)
    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', (e) => {
            e.preventDefault();
            triggerToast('Thanks for reaching out! We will get back to you soon.');
            contactForm.reset();
        });
    }

    // Load initial UI state: we rely on onAuthStateChanged to set the proper view
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
