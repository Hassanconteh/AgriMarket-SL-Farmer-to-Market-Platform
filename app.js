// App logic migrated to Firebase Auth + Firestore with server-side queries, pagination and better UX

const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1574943320219-553eb213f72d?auto=format&fit=crop&w=500&q=80";

// UID of the account allowed to publish listings (that's you). Find your
// UID in Firebase Console -> Authentication -> Users -> copy the "User UID"
// column for your account, then paste it here. This is checked again
// server-side by the Firestore security rules below — this client-side
// check only controls whether the button/form is shown, it is NOT the
// actual security boundary.
const ADMIN_UID = "Hekzmx48mPXukHAcHzQI1Uq7AWW2";

const landingPage   = document.getElementById('landingPage');
const dashboardApp  = document.getElementById('dashboardApp');
const navMenu       = document.getElementById('navMenu');
const authModal     = document.getElementById('authModal');
const loginForm     = document.getElementById('loginForm');
const registerForm  = document.getElementById('registerForm');
const resetForm     = document.getElementById('resetForm');

const cropContainer = document.getElementById('cropCardsContainer');
const resultCountEl = document.getElementById('resultCount');

const addListingBtn    = document.getElementById('addListingBtn');
const addListingModal  = document.getElementById('addListingModal');
const addListingForm   = document.getElementById('addListingForm');
const addListingModalTitle    = document.getElementById('addListingModalTitle');
const addListingModalSubtitle = document.getElementById('addListingModalSubtitle');
const addListingSubmitBtn     = document.getElementById('addListingSubmitBtn');

const profileView   = document.getElementById('profileView');
const profileForm   = document.getElementById('profileForm');

const pendingApprovalsSection   = document.getElementById('pendingApprovalsSection');
const pendingApprovalsContainer = document.getElementById('pendingApprovalsContainer');
const pendingApprovalsCount     = document.getElementById('pendingApprovalsCount');

const mySubmissionsSection   = document.getElementById('mySubmissionsSection');
const mySubmissionsContainer = document.getElementById('mySubmissionsContainer');

const messagesModal        = document.getElementById('messagesModal');
const chatListView         = document.getElementById('chatListView');
const chatListContainer    = document.getElementById('chatListContainer');
const chatThreadView       = document.getElementById('chatThreadView');
const chatThreadTitle      = document.getElementById('chatThreadTitle');
const chatThreadSubtitle   = document.getElementById('chatThreadSubtitle');
const chatMessagesContainer = document.getElementById('chatMessagesContainer');
const chatMessageForm      = document.getElementById('chatMessageForm');
const chatMessageInput     = document.getElementById('chatMessageInput');

// Chat state. chatsUnsubscribe listens to the signed-in user's chat list
// for the whole session (started at sign-in, stopped at sign-out) so the
// unread badge stays live even when the Messages modal is closed.
// threadUnsubscribe only listens to whichever single thread is currently
// open, and gets torn down whenever the thread view closes/changes.
let chatsUnsubscribe = null;
let threadUnsubscribe = null;
let cachedChats = [];
let activeChatId = null;
let currentPresenceUid = null;

const blogContainer    = document.getElementById('blogCardsContainer');
const blogModal        = document.getElementById('blogModal');
const blogModalContent = document.getElementById('blogModalContent');

// Pagination & query state
let pageSize = 8;
let lastVisible = null; // last document snapshot for pagination
let isLoading = false;
let currentQueryOptions = { searchTerm: '', location: 'All' };

// Escapes HTML-significant characters so untrusted data (crop listings can be
// created by any signed-in user) can never inject markup/scripts when we
// build card HTML with template strings below. Always run user-supplied or
// database-supplied text through this before interpolating into innerHTML.
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

// Resolves a friendly first name for the navbar instead of showing the raw
// email address. Order of preference:
//   1. The Auth profile's displayName (set at registration going forward).
//   2. For older accounts registered before we started setting displayName,
//      fall back to the full_name we saved in their Firestore profile doc,
//      and backfill the Auth displayName so this lookup isn't needed again.
//   3. Worst case, the part of the email before the @.
async function getFirstName(user) {
    if (user?.displayName) {
        const first = user.displayName.trim().split(/\s+/)[0];
        if (first) return first;
    }
    try {
        const { doc, getDoc } = window.dbFns;
        const db = window.firebaseDb;
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) {
            const fullName = snap.data().full_name;
            const first = fullName ? String(fullName).trim().split(/\s+/)[0] : '';
            if (first) {
                window.authFns.updateProfile?.(user, { displayName: first }).catch(() => {});
                return first;
            }
        }
    } catch (err) {
        console.warn('Could not look up stored full name', err);
    }
    return user?.email ? user.email.split('@')[0] : 'there';
}

// Resolves the photo to show for a user. A custom uploaded photo (the
// base64 photo_url saved on the user's Firestore doc by the avatar upload
// flow, see "Profile photo upload" below) always takes priority — otherwise
// a signed-in Google user's uploaded photo would never show, since Google
// Sign-In sets user.photoURL to their Google account photo by default and
// that flow intentionally never overwrites it. Falls back to user.photoURL
// (e.g. the Google photo) only when no custom upload exists.
async function getAvatarPhotoUrl(user) {
    try {
        const { doc, getDoc } = window.dbFns;
        const db = window.firebaseDb;
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists() && snap.data().photo_url) return snap.data().photo_url;
    } catch (err) {
        console.warn('Could not look up stored profile photo', err);
    }
    return user?.photoURL || '';
}

function triggerToast(message) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// A toast with a single action button (e.g. "Resend email"), left on screen
// longer than a plain toast since it needs to be read and clicked rather
// than just glanced at.
function triggerActionToast(message, actionLabel, actionFn) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast toast-action';

    const text = document.createElement('span');
    text.textContent = message;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action-btn';
    btn.textContent = actionLabel;
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Sending…';
        try {
            await actionFn();
        } finally {
            toast.remove();
        }
    });

    toast.appendChild(text);
    toast.appendChild(btn);
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 10000);
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

// NOTE: The static "Privacy / Terms / Support / Contact" pages and their
// window.showPage() router are defined once, in index.html (see the
// "STATIC PAGE SYSTEM" inline script). That version owns all four pages and
// is wired to the footer's "smart back" behavior. app.js used to define a
// second, incomplete copy of showPage() here (only 2 of the 4 pages) that
// loaded *after* the HTML's version and silently overwrote it — clicking
// "Terms of Service" or "Contact Us" in the footer did nothing as a result.
// That duplicate has been removed; do not redefine window.showPage here.

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
        if (code.includes('auth/popup-closed-by-user')) return 'Sign-in was cancelled.';
        if (code.includes('auth/cancelled-popup-request')) return 'Sign-in was cancelled.';
        if (code.includes('auth/account-exists-with-different-credential')) return 'This email is already registered using a different sign-in method. Try signing in with email/password instead.';
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

    // Firestore pagination means we only ever know the count of the current
    // page, not the total number of matching listings — so we count what's
    // actually rendered in the grid rather than just this batch, and phrase
    // it as "showing" to avoid implying it's a grand total.
    const totalRendered = append ? cropContainer.querySelectorAll('.card').length + listings.length : listings.length;
    resultCountEl.textContent = `Showing ${totalRendered} listing${totalRendered !== 1 ? 's' : ''}`;

    listings.forEach((item) => {
        // Escape every field before interpolating — listing data comes from
        // Firestore and can be created by any signed-in user, so it must be
        // treated as untrusted input (prevents stored XSS via a malicious
        // crop name, etc.).
        //
        // NOTE: farmer_name and phone are intentionally NOT read from this
        // document anymore. Firestore security rules can only allow/deny a
        // whole document, not individual fields, so "sensitive fields
        // require email verification" has to be enforced by moving those
        // fields to a separate document — crops/{id}/private/contact — with
        // its own rule. See handleContactFarmerClick() below, which fetches
        // that subdocument only after confirming the user is verified.
        const name       = escapeHtml(item.name || 'Unnamed listing');
        const location   = escapeHtml(item.location || '');
        const category   = escapeHtml(item.category || '');
        const imageUrl   = escapeHtml(item.image_url || FALLBACK_IMAGE);
        const cropId     = escapeHtml(item.id || '');

        const currentUid = window.firebaseAuth?.currentUser?.uid;
        const isAdminViewing = currentUid === ADMIN_UID;
        // Hide "Message Seller" on your own listing (nothing to message
        // yourself about) and for signed-out visitors (openOrCreateChat
        // requires being signed in anyway).
        const showMessageSeller = currentUid && item.submitted_by && item.submitted_by !== currentUid;

        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <img src="${imageUrl}" alt="${name}" class="card-img" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}'">
            <div class="card-content">
                <div class="badge-row">
                    ${location ? `<span class="badge badge-location"><i data-lucide="map-pin"></i> ${location}</span>` : ''}
                    ${category ? `<span class="badge badge-category">${category}</span>` : ''}
                </div>
                <h3 class="card-title">${name}</h3>
                <span class="card-price">SLLE ${Number(item.price || 0).toLocaleString()}</span>
                <button type="button" class="btn-contact" data-crop-id="${cropId}"><i data-lucide="phone"></i> Contact Farmer</button>
                ${showMessageSeller ? `<button type="button" class="btn-message-seller" data-action="message-seller" data-id="${cropId}"><i data-lucide="message-circle"></i> Message Seller</button>` : ''}
                ${showMessageSeller ? `<button type="button" class="btn-add-cart" data-action="add-cart" data-id="${cropId}"><i data-lucide="shopping-cart"></i> Add to Cart</button>` : ''}
                ${isAdminViewing ? `
                <div class="admin-card-actions">
                    <button type="button" class="btn-manage" data-action="return-to-pending" data-id="${cropId}">Return to Pending</button>
                    <button type="button" class="btn-delete" data-action="delete" data-id="${cropId}">Delete</button>
                </div>` : ''}
            </div>
        `;
        if (showMessageSeller) {
            card.querySelector('[data-action="message-seller"]')?.addEventListener('click', () => {
                openOrCreateChat({
                    otherUid: item.submitted_by,
                    otherLabel: item.farmer_display_name || 'Farmer',
                    type: 'listing',
                    cropId: item.id,
                    cropName: item.name || 'Listing'
                });
            });
            card.querySelector('[data-action="add-cart"]')?.addEventListener('click', () => {
                addToCart({
                    crop_id: item.id,
                    name: item.name || 'Unnamed listing',
                    price: Number(item.price || 0),
                    image_url: item.image_url || FALLBACK_IMAGE,
                    category: item.category || '',
                    location: item.location || '',
                    farmer_uid: item.submitted_by,
                    farmer_name: item.farmer_display_name || 'Farmer'
                });
            });
        }
        if (item.id) {
            card.querySelector('.btn-contact')?.addEventListener('click', (e) => {
                e.preventDefault();
                handleContactFarmerClick(item.id);
            });
            if (isAdminViewing) {
                card.querySelector('[data-action="return-to-pending"]')?.addEventListener('click', () => {
                    const comment = window.prompt('Optional note for the farmer on why this was sent back (leave blank to skip):', '');
                    if (comment === null) return; // cancelled
                    handleReviewListing(item.id, 'pending', comment, { refreshLive: true });
                });
                card.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
                    handleDeleteListing(item.id, { refreshLive: true });
                });
            }
        }
        cropContainer.appendChild(card);
        if (item.id && item.submitted_by !== currentUid) observeCropView(item.id, card);
    });
}

// ===== Listing view tracking =====
// Counts an "impression" the first time a card actually scrolls into the
// visitor's viewport (not just when it's rendered into the DOM — cards can
// be created off-screen or re-rendered on filter changes without a human
// ever seeing them). Deduped per browser session via viewedCropIds so
// re-renders of the same listing (pagination, filters, tab switches)
// don't inflate the count. Farmers viewing their own listing are excluded
// in the caller above.
const viewedCropIds = new Set();
let cropViewObserver = null;
function getCropViewObserver() {
    if (cropViewObserver) return cropViewObserver;
    cropViewObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const cropId = entry.target.dataset.viewCropId;
            cropViewObserver.unobserve(entry.target);
            if (!cropId || viewedCropIds.has(cropId)) return;
            viewedCropIds.add(cropId);
            incrementCropView(cropId);
        });
    }, { threshold: 0.5 });
    return cropViewObserver;
}
function observeCropView(cropId, cardEl) {
    if (viewedCropIds.has(cropId)) return;
    cardEl.dataset.viewCropId = cropId;
    getCropViewObserver().observe(cardEl);
}
async function incrementCropView(cropId) {
    const db = window.firebaseDb;
    const { doc, updateDoc, increment } = window.dbFns;
    try {
        await updateDoc(doc(db, 'crops', cropId), { view_count: increment(1) });
    } catch (err) {
        // Non-critical — a missed view count shouldn't surface an error to
        // the visitor browsing listings.
        console.warn('Could not record listing view', err);
    }
}

// ===== Email verification gate for contacting farmers =====
// Farmer contact info (name + phone) lives in a separate, per-crop
// subdocument — crops/{cropId}/private/contact — rather than on the public
// crop document. Firestore rules enforce
// request.auth.token.email_verified == true on reads of that subdocument,
// so this is a real server-side gate, not just a UI nicety.
async function handleContactFarmerClick(cropId) {
    const auth = window.firebaseAuth;
    const user = auth?.currentUser;

    if (!user) {
        triggerToast('Please sign in to contact farmers.');
        return;
    }

    // Refresh the user's status so our own UI check below isn't working
    // off stale data (e.g. they verified in another tab since the last
    // token refresh).
    try {
        await user.reload();
    } catch (err) {
        console.warn('Could not refresh user status before contact check', err);
    }

    if (!user.emailVerified) {
        showVerifyEmailPrompt(user);
        return;
    }

    // The Firestore rule reads request.auth.token.email_verified from the
    // user's ID token, which only auto-refreshes about once an hour. If
    // they just verified their email, the cached token might still say
    // false — force a refresh so the upcoming read doesn't get wrongly
    // denied right after verifying.
    try {
        await user.getIdToken(true);
    } catch (err) {
        console.warn('Could not refresh ID token before contact check', err);
    }

    const db = window.firebaseDb;
    const { doc, getDoc } = window.dbFns;

    try {
        const contactSnap = await getDoc(doc(db, 'crops', cropId, 'private', 'contact'));
        if (!contactSnap.exists()) {
            triggerToast('Contact info is not available for this listing.');
            return;
        }
        const contact = contactSnap.data();
        const phone = contact.phone;
        const farmerName = contact.farmer_name;

        if (!phone) {
            triggerToast('This listing has no phone number on file.');
            return;
        }

        if (farmerName) triggerToast(`Connecting you to ${farmerName}…`);
        window.location.href = `tel:${phone}`;
    } catch (err) {
        console.error('Failed to fetch farmer contact info', err);
        triggerToast(mapFirebaseError(err));
    }
}

function showVerifyEmailPrompt(user) {
    triggerActionToast(
        'Please verify your email before contacting farmers.',
        'Resend email',
        async () => {
            try {
                const { sendEmailVerification } = window.authFns;
                await sendEmailVerification(user);
                triggerToast('Verification email sent. Check your inbox.');
            } catch (err) {
                console.error('Failed to resend verification email', err);
                triggerToast(mapFirebaseError(err));
            }
        }
    );
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

        // Public listings only ever show approved crops — pending
        // submissions stay invisible until the admin approves them, and
        // rejected ones stay hidden permanently. IMPORTANT: any crop docs
        // created before this field existed won't have a 'status' field
        // and will be excluded by this filter — they need 'status: approved'
        // added manually (or re-created via the Add Listing form) or they
        // will silently disappear from the marketplace.
        constraints.push(where('status', '==', 'approved'));

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
                const parts = [where('status', '==', 'approved')];
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

// ===== Dashboard notifications =====
// A bell icon lives in the sticky navbar (always visible while on the
// dashboard, regardless of scroll position) and opens a dropdown listing
// announcements from a public 'notifications' Firestore collection.
//
// Read/unread state is stored per-user in Firestore, at
// users/{uid}/read_notifications/{notificationId} — one doc per
// notification the user has opened. This is what makes it sync across
// devices: reading a notification on your phone marks it read on your
// laptop too, next time it loads. The in-memory Set below is just a
// session cache so we don't re-fetch on every click.
// NOTE: requires Firestore rules allowing:
//   - public reads of 'notifications' (match /notifications/{id} { allow read: if true; })
//   - a user to read/write only their own read-receipts, e.g.:
//     match /users/{userId}/read_notifications/{notifId} {
//       allow read, write: if request.auth != null && request.auth.uid == userId;
//     }

const NOTIFICATION_ICONS = {
    info: 'info',
    success: 'circle-check',
    warning: 'triangle-alert',
    urgent: 'bell'
};

let currentNotifications = [];         // last-loaded batch, kept in memory for the dropdown
let readNotificationIdsCache = new Set(); // session cache of this user's read-notification IDs

// Fetches which notifications this user has already read, from their
// Firestore read-receipts subcollection. Called once per login.
async function loadReadNotificationIds(uid) {
    const { collection, getDocs } = window.dbFns;
    const db = window.firebaseDb;
    try {
        const snap = await getDocs(collection(db, 'users', uid, 'read_notifications'));
        readNotificationIdsCache = new Set(snap.docs.map((d) => d.id));
    } catch (err) {
        console.warn('Could not load read notifications', err);
        readNotificationIdsCache = new Set();
    }
}

// Updates the in-memory/UI state immediately (optimistic update) and
// returns whether it was actually a change (i.e. it was previously unread).
function markReadLocally(id) {
    if (readNotificationIdsCache.has(id)) return false;
    readNotificationIdsCache.add(id);
    return true;
}

// Persists a single read receipt to Firestore in the background. Fire-and-
// forget by design — the UI has already updated optimistically above, so a
// slow or failed write shouldn't block or flicker the interface. If it
// fails (e.g. offline), the notification will just get marked again on a
// future visit, which is harmless.
function persistNotificationRead(uid, id) {
    if (!uid) return;
    const { doc, setDoc } = window.dbFns;
    const db = window.firebaseDb;
    setDoc(doc(db, 'users', uid, 'read_notifications', id), { read_at: new Date().toISOString() })
        .catch((err) => console.warn('Could not persist read notification', err));
}

function markAllNotificationsRead() {
    const uid = window.firebaseAuth?.currentUser?.uid;
    const newlyRead = currentNotifications.filter((n) => markReadLocally(n.id));
    if (newlyRead.length === 0 || !uid) return;

    // A batch write is one round trip instead of one per notification.
    const { doc, writeBatch } = window.dbFns;
    const db = window.firebaseDb;
    const batch = writeBatch(db);
    newlyRead.forEach((n) => {
        batch.set(doc(db, 'users', uid, 'read_notifications', n.id), { read_at: new Date().toISOString() });
    });
    batch.commit().catch((err) => console.warn('Could not persist read notifications', err));
}

// Only allow http(s) links for the optional CTA button — escaping protects
// against injected markup, but not against a javascript: URL scheme, which
// needs its own check.
function isSafeUrl(url) {
    try {
        const parsed = new URL(url, window.location.origin);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function updateNotifBadge() {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    const unreadCount = currentNotifications.filter((n) => !readNotificationIdsCache.has(n.id)).length;
    if (unreadCount > 0) {
        badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
        badge.hidden = false;
    } else {
        badge.hidden = true;
    }
}

function renderNotificationDropdown() {
    const list = document.getElementById('notifDropdownList');
    if (!list) return;

    if (currentNotifications.length === 0) {
        list.innerHTML = '<div class="notif-dropdown-empty">No notifications yet.</div>';
        return;
    }

    const uid = window.firebaseAuth?.currentUser?.uid;
    list.innerHTML = '';
    currentNotifications.forEach((n) => {
        const isUnread = !readNotificationIdsCache.has(n.id);
        const type = ['info', 'success', 'warning', 'urgent'].includes(n.type) ? n.type : 'info';
        // Every field is escaped before interpolation, same as blog posts.
        const title    = escapeHtml(n.title || '');
        const message  = escapeHtml(n.message || '');
        const dateStr  = formatBlogDate(n.created_at);
        const linkUrl  = n.link_url && isSafeUrl(n.link_url) ? escapeHtml(n.link_url) : '';
        const linkText = escapeHtml(n.link_text || 'Learn more');

        const row = document.createElement('div');
        row.className = `notif-row${isUnread ? ' unread' : ''}`;
        row.innerHTML = `
            <div class="notif-row-icon-wrap notif-icon-${type}"><i data-lucide="${NOTIFICATION_ICONS[type]}"></i></div>
            <div class="notif-row-body">
                <div class="notif-row-title">${isUnread ? '<span class="notif-unread-dot"></span>' : ''}${title}</div>
                ${message ? `<div class="notif-row-message">${message}</div>` : ''}
                ${dateStr ? `<div class="notif-row-date">${dateStr}</div>` : ''}
                ${linkUrl ? `<a href="${linkUrl}" target="_blank" rel="noopener noreferrer" class="notif-row-link">${linkText} <i data-lucide="external-link"></i></a>` : ''}
            </div>
        `;
        row.querySelector('.notif-row-link')?.addEventListener('click', (e) => e.stopPropagation());
        row.addEventListener('click', () => {
            if (markReadLocally(n.id)) {
                row.classList.remove('unread');
                row.querySelector('.notif-unread-dot')?.remove();
                updateNotifBadge();
                persistNotificationRead(uid, n.id);
            }
        });
        list.appendChild(row);
    });
}

async function loadNotifications() {
    const uid = window.firebaseAuth?.currentUser?.uid;
    if (uid) {
        await loadReadNotificationIds(uid);
    } else {
        readNotificationIdsCache = new Set();
    }

    const { collection, getDocs, query, orderBy, limit } = window.dbFns;
    const db = window.firebaseDb;

    try {
        const notifCol = collection(db, 'notifications');
        // Single orderBy only (no `where`) so this never needs a composite
        // index — 'active' and 'expires_at' are filtered client-side below,
        // same approach used for blog posts.
        const q = query(notifCol, orderBy('created_at', 'desc'), limit(10));
        const snap = await getDocs(q);
        const now = Date.now();

        currentNotifications = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((n) => n.active !== false)
            .filter((n) => {
                if (!n.expires_at) return true;
                const expires = typeof n.expires_at?.toDate === 'function' ? n.expires_at.toDate() : new Date(n.expires_at);
                return isNaN(expires.getTime()) || expires.getTime() > now;
            });

        updateNotifBadge();
        renderNotificationDropdown();
    } catch (err) {
        // Fail quietly — a broken notification feed shouldn't block the dashboard.
        console.error('Failed to load notifications', err);
        const list = document.getElementById('notifDropdownList');
        if (list) list.innerHTML = '<div class="notif-dropdown-empty">Could not load notifications.</div>';
    }
}

// Wires up the bell button + dropdown. Must be called again every time the
// navbar markup is re-rendered (renderAuthedNav replaces navMenu.innerHTML,
// which destroys any previously attached listeners on these elements).
function setupNotificationBell() {
    const bellBtn = document.getElementById('notifBellBtn');
    const dropdown = document.getElementById('notifDropdown');
    const markAllBtn = document.getElementById('notifMarkAllBtn');
    if (!bellBtn || !dropdown) return;

    bellBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = !dropdown.hidden;
        dropdown.hidden = isOpen;
        bellBtn.setAttribute('aria-expanded', String(!isOpen));
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.hidden && !dropdown.contains(e.target) && e.target !== bellBtn) {
            dropdown.hidden = true;
            bellBtn.setAttribute('aria-expanded', 'false');
        }
    });

    markAllBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        markAllNotificationsRead();
        updateNotifBadge();
        renderNotificationDropdown();
    });
}

// ===== Blog =====
// Public marketing content, read from a 'posts' Firestore collection — not
// gated behind sign-in, since it's meant to be visible on the landing page.
// NOTE: this requires your Firestore rules to allow public reads of
// 'posts' (e.g. allow read: if true;), since visitors browsing the landing
// page haven't signed in yet.

function renderBlogEmptyState(message) {
    if (!blogContainer) return;
    blogContainer.innerHTML = `<div class="blog-empty">${escapeHtml(message)}</div>`;
}

// Accepts a Firestore Timestamp, ISO string, or epoch millis and returns a
// short human-readable date, or '' if it can't be parsed.
function formatBlogDate(value) {
    if (!value) return '';
    try {
        const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
        if (isNaN(date.getTime())) return '';
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return '';
    }
}

async function loadBlogPosts() {
    if (!blogContainer) return;
    const { collection, getDocs, query, orderBy, limit } = window.dbFns;
    const db = window.firebaseDb;
    try {
        const postsCol = collection(db, 'posts');
        const q = query(postsCol, orderBy('published_at', 'desc'), limit(6));
        const snap = await getDocs(q);

        if (snap.empty) {
            renderBlogEmptyState('No blog posts yet — check back soon!');
            return;
        }

        blogContainer.innerHTML = '';
        snap.docs.forEach((d) => {
            const post = { id: d.id, ...d.data() };
            // Every field is escaped before interpolation — posts come from
            // Firestore and should be treated as untrusted, the same as crop
            // listings (see renderListings above).
            const title   = escapeHtml(post.title || 'Untitled post');
            const excerpt = escapeHtml(post.excerpt || '');
            const tag     = escapeHtml(post.category || '');
            const author  = escapeHtml(post.author || 'AgriMarket SL Team');
            const image   = escapeHtml(post.image_url || FALLBACK_IMAGE);
            const dateStr = formatBlogDate(post.published_at);

            const card = document.createElement('div');
            card.className = 'blog-card';
            card.innerHTML = `
                <img src="${image}" alt="${title}" class="blog-card-img" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}'">
                <div class="blog-card-content">
                    ${tag ? `<span class="blog-tag">${tag}</span>` : ''}
                    <h3>${title}</h3>
                    <p class="blog-meta">${author}${dateStr ? ' · ' + dateStr : ''}</p>
                    <p>${excerpt}</p>
                    <button type="button" class="blog-read-more">Read more <i data-lucide="arrow-right"></i></button>
                </div>
            `;
            card.querySelector('.blog-read-more').addEventListener('click', () => openBlogPost(post.id));
            blogContainer.appendChild(card);
        });
    } catch (err) {
        console.error('Failed to load blog posts', err);
        renderBlogEmptyState('Could not load blog posts right now. Please try again later.');
    }
}

async function openBlogPost(postId) {
    const { doc, getDoc } = window.dbFns;
    const db = window.firebaseDb;

    blogModalContent.innerHTML = '<p style="text-align:center;padding:2rem 0;">Loading…</p>';
    blogModal.classList.add('active');

    try {
        const snap = await getDoc(doc(db, 'posts', postId));
        if (!snap.exists()) {
            blogModalContent.innerHTML = '<p>This post could not be found.</p>';
            return;
        }
        const post = snap.data();
        const title   = escapeHtml(post.title || 'Untitled post');
        const author  = escapeHtml(post.author || 'AgriMarket SL Team');
        const image   = escapeHtml(post.image_url || FALLBACK_IMAGE);
        const dateStr = formatBlogDate(post.published_at);

        // The full body is escaped first (never trust Firestore content),
        // then split into paragraphs on blank lines so basic formatting
        // survives without ever allowing raw HTML/script injection.
        const bodyHtml = String(post.content || post.excerpt || '')
            .split(/\n{2,}/)
            .map((para) => `<p>${escapeHtml(para.trim()).replace(/\n/g, '<br>')}</p>`)
            .join('');

        blogModalContent.innerHTML = `
            <img src="${image}" alt="${title}" class="blog-modal-img" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}'">
            <h2>${title}</h2>
            <p class="blog-modal-meta">${author}${dateStr ? ' · ' + dateStr : ''}</p>
            <div class="blog-modal-body">${bodyHtml || '<p>No content yet.</p>'}</div>
        `;
    } catch (err) {
        console.error('Failed to load blog post', err);
        blogModalContent.innerHTML = '<p>Sorry, something went wrong loading this post.</p>';
    }
}

async function applyFilters() {
    // Called when user submits search/filter. Reset pagination and load from server with filters
    const searchTerm = document.getElementById('searchInput').value.trim();
    const location   = document.getElementById('locationFilter').value;
    currentQueryOptions = { searchTerm, location };
    await loadInitialCrops();
}

// ===== Session security: auto sign-out after inactivity =====
// Signs the user out automatically after a period with no mouse/keyboard/
// touch/scroll activity, so a session left open on a shared or public
// computer doesn't stay signed in indefinitely. The timer only ever runs
// while someone is actually signed in (started in onAuthStateChanged below);
// the activity listeners are cheap no-ops otherwise since resetInactivityTimer
// checks auth.currentUser before scheduling anything.
//
// NOTE: this 15-minute inactivity timeout is intentionally independent of
// the "Remember me" checkbox below. Remember me only controls whether the
// session survives closing the browser — it does not disable the
// inactivity timeout, so a "remembered" session left idle for 15 minutes
// on a shared computer still gets signed out.
const INACTIVITY_LIMIT_MS = 15 * 60 * 1000; // 15 minutes
let inactivityTimeoutId = null;

function clearInactivityTimer() {
    if (inactivityTimeoutId) {
        clearTimeout(inactivityTimeoutId);
        inactivityTimeoutId = null;
    }
}

function resetInactivityTimer() {
    clearInactivityTimer();
    const auth = window.firebaseAuth;
    if (!auth?.currentUser) return; // nobody signed in — nothing to time out

    inactivityTimeoutId = setTimeout(async () => {
        try {
            const { signOut } = window.authFns;
            await signOut(auth);
            triggerToast("You've been signed out after 15 minutes of inactivity.");
        } catch (err) {
            console.warn('Auto sign-out failed', err);
        }
    }, INACTIVITY_LIMIT_MS);
}

// Attached once, unconditionally — resetInactivityTimer() itself no-ops
// when nobody is signed in, so there's no need to add/remove these per
// auth state change.
['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach((evt) => {
    document.addEventListener(evt, resetInactivityTimer, { passive: true });
});

// ===== "Remember me" (persist sign-in across browser restarts) =====
// Firebase Auth persistence must be set BEFORE the sign-in call it applies
// to — it's not something you can flip on an already-established session.
// index.html sets the default to session-only (signed out when the last
// tab closes) as soon as Firebase initializes; this lets the login form
// switch that to local persistence (survives closing the browser) for just
// the sign-in about to happen, based on the "Remember me" checkbox.
async function setAuthPersistence(auth, remember) {
    if (!window.authFns?.setPersistence) return;
    const { setPersistence, browserLocalPersistence, browserSessionPersistence } = window.authFns;
    try {
        await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    } catch (err) {
        console.warn('Could not set auth persistence', err);
    }
}

// ===== Google Sign-In =====
// Uses signInWithPopup as the primary method. This app's authDomain
// (agrimarket-sl.firebaseapp.com) is a different domain from where it's
// actually hosted (e.g. hassanconteh.github.io), and signInWithRedirect
// depends on storage being shared between those two domains to hand the
// signed-in session back to the app after the redirect. Browsers now
// routinely partition/block that cross-domain storage sharing (Chrome's
// third-party storage partitioning, Safari ITP, Firefox ETP), which made
// the redirect flow fail *silently* — Google would confirm sign-in, the
// page would come back, but no session ever appeared and no error was
// thrown. signInWithPopup instead passes the result back via postMessage
// between the popup and this window, which isn't affected by that storage
// partitioning at all.
//
// If the popup itself is blocked (some mobile browsers block popups
// outright), we fall back to signInWithRedirect rather than leaving the
// user stuck — it's less reliable here, but better than nothing.
function signInWithGoogleHandler(auth) {
    const { signInWithPopup, signInWithRedirect } = window.authFns;
    const provider = window.googleProvider;
    signInWithPopup(auth, provider).then((result) => {
        handleGoogleSignInSuccess(result);
    }).catch((err) => {
        const popupBlockedCodes = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'];
        if (popupBlockedCodes.includes(err?.code)) {
            console.warn('Popup sign-in unavailable, falling back to redirect', err);
            signInWithRedirect(auth, provider).catch((redirectErr) => {
                console.error('Could not start Google sign-in', redirectErr);
                triggerToast(mapFirebaseError(redirectErr));
            });
            return;
        }
        console.error('Google sign-in failed', err);
        triggerToast(mapFirebaseError(err));
    });
}

// Shared success handler for both signInWithPopup and signInWithRedirect.
// On first sign-in we also create a 'users' profile doc, mirroring what the
// email/password registration flow writes, so getFirstName() and any other
// code that reads users/{uid} keeps working the same regardless of which
// sign-in method someone used. Needs window.firebaseDb, so it's safe to
// call once initApp has run (both call sites already require that).
async function handleGoogleSignInSuccess(result) {
    if (!result || !result.user) return;
    const db = window.firebaseDb;
    const user = result.user;

    // Close and toast immediately, before touching Firestore at all — the
    // sign-in itself already succeeded at this point, so there's no reason
    // to make the user wait on a profile-doc round trip just to see the
    // modal go away. onAuthStateChanged (registered in initApp) already
    // handles showing the dashboard and rendering the navbar once the auth
    // state resolves.
    closeModal();
    const firstName = user.displayName ? user.displayName.trim().split(/\s+/)[0] : '';
    triggerToast(firstName ? `Welcome, ${firstName}!` : 'Signed in with Google.');

    // On first sign-in, create a 'users' profile doc in the background,
    // mirroring what the email/password registration flow writes, so
    // getFirstName() and any other code that reads users/{uid} keeps
    // working the same regardless of which sign-in method someone used.
    try {
        const { doc, getDoc, setDoc } = window.dbFns;
        const profileRef = doc(db, 'users', user.uid);
        const snap = await getDoc(profileRef);
        if (!snap.exists()) {
            await setDoc(profileRef, {
                full_name: user.displayName || '',
                email: user.email || '',
                created_at: new Date().toISOString()
            });
        }
    } catch (err) {
        console.warn('Failed to write/check user profile for Google sign-in', err);
    }
}

// Called once on every page load to pick up the result of a redirect that
// just completed (the user is bounced back to this same page after
// approving on Google's side). Resolves to null/no user on a normal page
// load where no redirect was in flight (or if the primary popup flow was
// used instead), so it's safe to call unconditionally. This only remains
// as a fallback path for the rare case where signInWithPopup itself was
// blocked and signInWithGoogleHandler fell back to signInWithRedirect.
async function handleGoogleRedirectResult(auth, db) {
    try {
        const { getRedirectResult } = window.authFns;
        const result = await getRedirectResult(auth);
        await handleGoogleSignInSuccess(result);
    } catch (err) {
        console.error('Google sign-in failed', err);
        triggerToast(mapFirebaseError(err));
    }
}

// Creates a new crop listing. Writes the public 'crops/{id}' doc and the
// private 'crops/{id}/private/contact' doc together in a single batch, so
// it's impossible to end up with one but not the other (which is what
// caused "Contact info is not available" on listings added by hand through
// the Firebase Console).
//
// Behavior branches by role:
// - Admin: status is set to 'approved' and the listing is live immediately.
// - Any other signed-in, email-verified user: status is set to 'pending'
//   and submitted_by is stamped with their uid, so it only becomes visible
//   in the public listings once the admin approves it (see
//   loadPendingApprovals/handleApproveListing below).
// Both branches are re-checked server-side by the Firestore security rules
// on 'crops' — this is not just a client-side gate.
async function handleAddListingSubmit(e) {
    e.preventDefault();

    const auth = window.firebaseAuth;
    const user = auth?.currentUser;
    if (!user) {
        triggerToast('Please sign in first.');
        return;
    }

    const isAdmin = user.uid === ADMIN_UID;
    if (!isAdmin && !user.emailVerified) {
        triggerToast('Please verify your email before submitting a listing.');
        return;
    }

    const name       = document.getElementById('listingName').value.trim();
    const category   = document.getElementById('listingCategory').value.trim();
    const location   = document.getElementById('listingLocation').value;
    const price      = Number(document.getElementById('listingPrice').value);
    const imageUrl   = document.getElementById('listingImageUrl').value.trim();
    const farmerName = document.getElementById('listingFarmerName').value.trim();
    const phone      = document.getElementById('listingPhone').value.trim();

    if (!name || !category || !location || !price || !farmerName || !phone) {
        triggerToast('Please fill in all required fields.');
        return;
    }

    const db = window.firebaseDb;
    const { collection, doc, writeBatch } = window.dbFns;

    addListingSubmitBtn.disabled = true;
    addListingSubmitBtn.textContent = isAdmin ? 'Publishing…' : 'Submitting…';

    try {
        const cropRef = doc(collection(db, 'crops'));
        const batch = writeBatch(db);

        batch.set(cropRef, {
            name,
            name_lower: name.toLowerCase(), // required by the prefix-search query in fetchCropsFromFirestore
            category,
            location,
            price,
            image_url: imageUrl || '',
            status: isAdmin ? 'approved' : 'pending',
            submitted_by: user.uid,
            submitted_by_email: user.email || '',
            farmer_display_name: farmerName, // public label for chat — deliberately just the name, phone stays in private/contact
            created_at: new Date().toISOString()
        });

        batch.set(doc(db, 'crops', cropRef.id, 'private', 'contact'), {
            farmer_name: farmerName,
            phone,
            submitted_by: user.uid // denormalized so the Firestore rule can check ownership on create without a get() on the sibling doc (see note below)
        });

        await batch.commit();

        if (isAdmin) {
            triggerToast('Listing published.');
            await loadInitialCrops();
        } else {
            triggerToast("Listing submitted! We'll notify you once it's reviewed.");
            await loadMySubmissions(user.uid);
        }
        addListingForm.reset();
        addListingModal.classList.remove('active');
    } catch (err) {
        console.error('Failed to create listing', err);
        triggerToast(mapFirebaseError(err));
    } finally {
        addListingSubmitBtn.disabled = false;
        addListingSubmitBtn.textContent = isAdmin ? 'Publish Listing' : 'Submit for Review';
    }
}

// ===== Pending approvals (admin only) =====
async function loadPendingApprovals() {
    if (!pendingApprovalsContainer) return;
    const db = window.firebaseDb;
    const { collection, query, where, orderBy, getDocs } = window.dbFns;

    try {
        const q = query(collection(db, 'crops'), where('status', '==', 'pending'), orderBy('created_at', 'asc'));
        const snap = await getDocs(q);
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderPendingApprovals(items);
    } catch (err) {
        console.error('Failed to load pending approvals', err);
        triggerToast(mapFirebaseError(err));
    }
}

function renderPendingApprovals(items) {
    pendingApprovalsCount.textContent = items.length ? `${items.length} awaiting review` : '';
    pendingApprovalsContainer.innerHTML = '';

    if (!items.length) {
        pendingApprovalsContainer.innerHTML = '<p class="text-muted">No listings waiting for approval.</p>';
        return;
    }

    items.forEach((item) => {
        const name     = escapeHtml(item.name || 'Unnamed listing');
        const location = escapeHtml(item.location || '');
        const category = escapeHtml(item.category || '');
        const imageUrl = escapeHtml(item.image_url || FALLBACK_IMAGE);
        const email    = escapeHtml(item.submitted_by_email || 'unknown');

        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <img src="${imageUrl}" alt="${name}" class="card-img" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}'">
            <div class="card-content">
                <div class="badge-row">
                    ${location ? `<span class="badge badge-location"><i data-lucide="map-pin"></i> ${location}</span>` : ''}
                    ${category ? `<span class="badge badge-category">${category}</span>` : ''}
                </div>
                <h3 class="card-title">${name}</h3>
                <span class="card-price">SLLE ${Number(item.price || 0).toLocaleString()}</span>
                <p class="text-muted" style="font-size:0.8rem; margin: 0.25rem 0;">Submitted by ${email}</p>
                <div class="admin-card-actions">
                    <button type="button" class="btn-approve" data-id="${item.id}">Approve</button>
                    <button type="button" class="btn-reject" data-id="${item.id}">Reject</button>
                    <button type="button" class="btn-delete" data-id="${item.id}">Delete</button>
                </div>
            </div>
        `;
        card.querySelector('.btn-approve').addEventListener('click', () => handleReviewListing(item.id, 'approved'));
        card.querySelector('.btn-reject').addEventListener('click', () => {
            const comment = window.prompt('Optional reason for rejecting (shown to the farmer):', '');
            if (comment === null) return; // cancelled
            handleReviewListing(item.id, 'rejected', comment);
        });
        card.querySelector('.btn-delete').addEventListener('click', () => handleDeleteListing(item.id));
        pendingApprovalsContainer.appendChild(card);
    });
}

// newStatus: 'approved' | 'rejected' | 'pending' (the last one is used for
// "return to pending" on an already-live listing sent back for revision).
// comment is optional admin feedback shown to the farmer in "My Listings".
// opts.refreshLive additionally reloads the public grid, needed when the
// action affects a listing that's currently showing there (approve/reject
// happen from Pending Approvals, where the live grid isn't visible, so
// they don't need it; return-to-pending happens from the live grid itself).
async function handleReviewListing(cropId, newStatus, comment = '', opts = {}) {
    const db = window.firebaseDb;
    const { doc, setDoc } = window.dbFns;
    try {
        // setDoc with merge:true only touches these fields, leaving the
        // rest of the listing (and the separate private/contact doc)
        // untouched — matches the Firestore rule, which only allows the
        // admin to update 'crops' docs, not farmers editing their own after
        // submission.
        await setDoc(doc(db, 'crops', cropId), {
            status: newStatus,
            admin_comment: comment || ''
        }, { merge: true });

        const messages = {
            approved: 'Listing approved and now live.',
            rejected: 'Listing rejected.',
            pending: 'Listing sent back to pending for revision.'
        };
        triggerToast(messages[newStatus] || 'Listing updated.');

        await loadPendingApprovals();
        if (newStatus === 'approved' || opts.refreshLive) await loadInitialCrops();
    } catch (err) {
        console.error('Failed to update listing status', err);
        triggerToast(mapFirebaseError(err));
    }
}

// Permanently deletes a listing and its private contact doc together.
// opts.refreshLive additionally reloads the public grid (needed when
// deleting from a live listing card rather than Pending Approvals).
async function handleDeleteListing(cropId, opts = {}) {
    if (!window.confirm('Delete this listing permanently? This cannot be undone.')) return;

    const db = window.firebaseDb;
    const { doc, writeBatch } = window.dbFns;
    try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'crops', cropId, 'private', 'contact'));
        batch.delete(doc(db, 'crops', cropId));
        await batch.commit();

        triggerToast('Listing deleted.');
        await loadPendingApprovals();
        if (opts.refreshLive) await loadInitialCrops();
    } catch (err) {
        console.error('Failed to delete listing', err);
        triggerToast(mapFirebaseError(err));
    }
}

// ===== My submissions (farmers) =====
async function loadMySubmissions(uid) {
    if (!mySubmissionsContainer) return;
    const db = window.firebaseDb;
    const { collection, query, where, orderBy, getDocs } = window.dbFns;

    try {
        const q = query(collection(db, 'crops'), where('submitted_by', '==', uid), orderBy('created_at', 'desc'));
        const snap = await getDocs(q);
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderMySubmissions(items);
    } catch (err) {
        console.error('Failed to load your submissions', err);
        triggerToast(mapFirebaseError(err));
    }
}

function renderMySubmissions(items) {
    mySubmissionsContainer.innerHTML = '';

    if (!items.length) {
        mySubmissionsContainer.innerHTML = '<p class="text-muted">You haven\'t submitted any listings yet.</p>';
        return;
    }

    const statusLabels = { pending: 'Pending review', approved: 'Approved', rejected: 'Rejected' };

    items.forEach((item) => {
        const name     = escapeHtml(item.name || 'Unnamed listing');
        const location = escapeHtml(item.location || '');
        const category = escapeHtml(item.category || '');
        const imageUrl = escapeHtml(item.image_url || FALLBACK_IMAGE);
        const status   = item.status || 'pending';
        const statusLabel = escapeHtml(statusLabels[status] || status);
        const adminComment = escapeHtml(item.admin_comment || '');

        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <img src="${imageUrl}" alt="${name}" class="card-img" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}'">
            <div class="card-content">
                <div class="badge-row">
                    <span class="badge badge-status-${status}">${statusLabel}</span>
                    ${location ? `<span class="badge badge-location"><i data-lucide="map-pin"></i> ${location}</span>` : ''}
                    ${category ? `<span class="badge badge-category">${category}</span>` : ''}
                </div>
                <h3 class="card-title">${name}</h3>
                <span class="card-price">SLLE ${Number(item.price || 0).toLocaleString()}</span>
                ${adminComment && (status === 'rejected' || status === 'pending') ? `<p class="admin-comment-note"><i data-lucide="message-circle"></i> <strong>Admin note:</strong> ${adminComment}</p>` : ''}
            </div>
        `;
        mySubmissionsContainer.appendChild(card);
    });
}

// ===== End-to-end encryption (E2EE) for chat =====
// Each user gets a device-local ECDH (P-256) key pair the first time chat
// is used on a given browser. The PRIVATE key never leaves this browser —
// it lives in IndexedDB and is never written to Firestore or sent anywhere.
// Only the public key is published, to public_keys/{uid}.pub_key_jwk, since
// a public key is safe to share with anyone.
//
// For a given 1:1 conversation, both participants independently derive the
// *same* AES-256 key on their own device via ECDH (my private key + their
// public key). That shared key never touches the server either. Messages
// are encrypted with it before being written to Firestore, so Firestore
// only ever stores ciphertext for an encrypted chat — not the message text.
//
// Trade-offs worth knowing (this is inherent to real E2EE, not a bug):
//  - The private key lives only in this browser's storage. Clearing site
//    data, or opening the app in a different browser/device, generates a
//    NEW key pair — messages encrypted under the OLD one can no longer be
//    decrypted there. There is no server-side key recovery by design.
//  - If the other participant hasn't opened the app since this shipped (so
//    they have no public key on file yet), that conversation falls back to
//    plain text with an explicit `enc:false` flag, and the thread header
//    shows an "unlocked" badge so it's never silently insecure.
//
// IMPORTANT — Firestore security rules requirement: this only works if any
// signed-in user can READ another user's `public_keys/{uid}` doc, while
// still only being able to WRITE their own. Public keys aren't secret, so a
// rule along these lines is needed (kept separate from `users/{uid}`, which
// also holds things like email, so that collection can stay locked down):
//   match /public_keys/{uid} {
//     allow read: if request.auth != null;
//     allow write: if request.auth != null && request.auth.uid == uid;
//   }

const E2EE_DB_NAME = 'agrimarket_e2ee';
const E2EE_STORE = 'keypairs';

function openE2eeDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(E2EE_DB_NAME, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore(E2EE_STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbGet(key) {
    const db = await openE2eeDb();
    return new Promise((resolve, reject) => {
        const req = db.transaction(E2EE_STORE, 'readonly').objectStore(E2EE_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

async function idbSet(key, value) {
    const db = await openE2eeDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(E2EE_STORE, 'readwrite');
        tx.objectStore(E2EE_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

let myE2eeKeyPair = null;          // { publicKey, privateKey } CryptoKey objects, for this session
const sharedKeyCache = new Map();  // chatId -> derived AES-GCM CryptoKey, or null if unavailable
const otherPubKeyCache = new Map(); // otherUid -> JWK, or null if they don't have one published

function e2eeSupported() {
    return !!(window.crypto && window.crypto.subtle && window.indexedDB);
}

// Loads this browser's stored key pair for `uid`, generating and publishing
// a new one on first use. Safe to call every time a user signs in.
async function initE2EE(uid) {
    if (!e2eeSupported()) return;
    try {
        let pair = await idbGet(uid);
        if (!pair) {
            pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
            await idbSet(uid, pair);
        }
        myE2eeKeyPair = pair;

        const db = window.firebaseDb;
        const { doc, getDoc, setDoc } = window.dbFns;
        const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);

        const keyRef = doc(db, 'public_keys', uid);
        const snap = await getDoc(keyRef);
        const existingJwk = snap.exists() ? snap.data()?.pub_key_jwk : null;
        // Only write if it actually changed, to avoid a redundant write on
        // every single login.
        if (JSON.stringify(existingJwk) !== JSON.stringify(publicJwk)) {
            await setDoc(keyRef, { pub_key_jwk: publicJwk }, { merge: true });
        }
    } catch (err) {
        console.warn('E2EE setup failed — chat will fall back to plain text', err);
        myE2eeKeyPair = null;
    }
}

function clearE2eeSession() {
    myE2eeKeyPair = null;
    sharedKeyCache.clear();
    otherPubKeyCache.clear();
}

async function fetchOtherPublicKey(otherUid) {
    if (otherPubKeyCache.has(otherUid)) return otherPubKeyCache.get(otherUid);
    try {
        const db = window.firebaseDb;
        const { doc, getDoc } = window.dbFns;
        const snap = await getDoc(doc(db, 'public_keys', otherUid));
        const jwk = snap.exists() ? (snap.data()?.pub_key_jwk || null) : null;
        otherPubKeyCache.set(otherUid, jwk);
        return jwk;
    } catch (err) {
        console.warn('Could not fetch public key for', otherUid, err);
        return null;
    }
}

// Derives (and caches) the shared AES-256 key for a 1:1 chat. Returns null
// if E2EE isn't available for this conversation yet (no Web Crypto/IndexedDB
// support, no local key pair, or the other person hasn't published a public
// key yet) — callers treat null as "fall back to plain text".
async function getSharedKeyForChat(chatId, otherUid) {
    if (!e2eeSupported() || !myE2eeKeyPair || !otherUid) return null;
    if (sharedKeyCache.has(chatId)) return sharedKeyCache.get(chatId);

    const otherJwk = await fetchOtherPublicKey(otherUid);
    if (!otherJwk) { sharedKeyCache.set(chatId, null); return null; }

    try {
        const otherPublicKey = await crypto.subtle.importKey('jwk', otherJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
        const sharedKey = await crypto.subtle.deriveKey(
            { name: 'ECDH', public: otherPublicKey },
            myE2eeKeyPair.privateKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
        sharedKeyCache.set(chatId, sharedKey);
        return sharedKey;
    } catch (err) {
        console.warn('Could not derive shared key for chat', chatId, err);
        sharedKeyCache.set(chatId, null);
        return null;
    }
}

function bufToBase64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function base64ToBuf(b64) {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function encryptChatText(sharedKey, text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, encoded);
    return { ciphertext: bufToBase64(ciphertext), iv: bufToBase64(iv) };
}

async function decryptChatText(sharedKey, ciphertextB64, ivB64) {
    const ciphertext = base64ToBuf(ciphertextB64);
    const iv = base64ToBuf(ivB64);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedKey, ciphertext);
    return new TextDecoder().decode(plainBuf);
}

function updateChatEncryptionBadge(isEncrypted) {
    const badge = document.getElementById('chatEncryptionBadge');
    if (!badge) return;
    badge.className = 'chat-encryption-badge ' + (isEncrypted ? 'chat-encryption-badge-on' : 'chat-encryption-badge-off');
    badge.innerHTML = isEncrypted ? '<i data-lucide="lock"></i>' : '<i data-lucide="unlock"></i>';
    badge.title = isEncrypted
        ? 'End-to-end encrypted — only you and the other person can read these messages'
        : 'Not yet encrypted — waiting for the other person to open the app at least once';
}

// ===== Presence & typing (Realtime Database) =====
// Uses Realtime Database rather than Firestore because RTDB has native
// onDisconnect() support: the server itself (not the client) writes the
// "offline" state the moment a connection drops — tab closed, network
// lost, laptop put to sleep — with no heartbeat or polling needed. This
// degrades gracefully to "no presence info" if RTDB isn't configured
// (databaseURL missing/wrong, or the database not yet enabled in the
// Firebase console) — see rtdbReady() below.
//
// Data model:
//   status/{uid}: { state: 'online' | 'offline', last_changed: <server ts> }
//   typing/{chatId}/{uid}: true, present only while that user is actively
//     typing in that chat; removed on idle timeout, on send, or on
//     disconnect (via onDisconnect, same as presence).
const TYPING_IDLE_MS = 3000;

let presenceInfoUnsub = null;      // .info/connected listener (one per session)
let chatListPresenceUnsubs = [];   // one pair of listeners per visible chat row
let threadStatusUnsub = null;      // open chat thread's header presence dot
let threadTypingUnsub = null;      // open chat thread's header "typing…" state
let typingIdleTimer = null;        // clears MY own typing flag after a pause

function rtdbReady() {
    return !!(window.firebaseRtdb && window.rtdbFns);
}

// Called on sign-in. Marks the current user online, and arranges for the
// server to mark them offline automatically if the connection drops
// without a clean sign-out (closed tab, lost network, etc).
function initPresence(uid) {
    if (!rtdbReady() || !uid) return;
    const rtdb = window.firebaseRtdb;
    const { ref, set, onValue, onDisconnect, serverTimestamp } = window.rtdbFns;

    if (presenceInfoUnsub) { presenceInfoUnsub(); presenceInfoUnsub = null; }

    const myStatusRef = ref(rtdb, `status/${uid}`);
    const connectedRef = ref(rtdb, '.info/connected');
    presenceInfoUnsub = onValue(connectedRef, (snap) => {
        if (snap.val() !== true) return; // fires on every (re)connect
        // Queue up the offline write BEFORE announcing ourselves online, so
        // there's never a moment where we're online with no cleanup armed.
        onDisconnect(myStatusRef).set({ state: 'offline', last_changed: serverTimestamp() })
            .then(() => set(myStatusRef, { state: 'online', last_changed: serverTimestamp() }))
            .catch((err) => console.warn('Could not set up presence', err));
    });
}

// Called on sign-out. Explicit + immediate, rather than waiting for
// onDisconnect to notice (which is really meant for the ungraceful case).
function teardownPresence(uid) {
    if (presenceInfoUnsub) { presenceInfoUnsub(); presenceInfoUnsub = null; }
    clearChatListPresence();
    clearThreadPresence();
    if (rtdbReady() && uid) {
        const { ref, set, serverTimestamp } = window.rtdbFns;
        set(ref(window.firebaseRtdb, `status/${uid}`), { state: 'offline', last_changed: serverTimestamp() }).catch(() => {});
    }
}

function subscribeToPresence(otherUid, cb) {
    if (!rtdbReady() || !otherUid) return () => {};
    const { ref, onValue } = window.rtdbFns;
    const statusRef = ref(window.firebaseRtdb, `status/${otherUid}`);
    return onValue(statusRef, (snap) => cb(snap.val()));
}

function subscribeToTyping(chatId, otherUid, cb) {
    if (!rtdbReady() || !chatId || !otherUid) return () => {};
    const { ref, onValue } = window.rtdbFns;
    const typingRef = ref(window.firebaseRtdb, `typing/${chatId}/${otherUid}`);
    return onValue(typingRef, (snap) => cb(!!snap.val()));
}

function clearChatListPresence() {
    chatListPresenceUnsubs.forEach((fn) => fn());
    chatListPresenceUnsubs = [];
}

function clearThreadPresence() {
    if (threadStatusUnsub) { threadStatusUnsub(); threadStatusUnsub = null; }
    if (threadTypingUnsub) { threadTypingUnsub(); threadTypingUnsub = null; }
}

function formatLastSeen(statusVal) {
    if (!statusVal || !statusVal.last_changed) return 'Offline';
    const diffMin = Math.floor((Date.now() - statusVal.last_changed) / 60000);
    if (diffMin < 1) return 'Last seen just now';
    if (diffMin < 60) return `Last seen ${diffMin}m ago`;
    if (diffMin < 60 * 24) return `Last seen ${Math.floor(diffMin / 60)}h ago`;
    return `Last seen ${Math.floor(diffMin / 1440)}d ago`;
}

// --- My own typing flag (written while I compose, read by the other side) ---
function notifyTyping() {
    if (!activeChatId || !rtdbReady()) return;
    const uid = window.firebaseAuth?.currentUser?.uid;
    if (!uid) return;
    const { ref, set, onDisconnect } = window.rtdbFns;
    const typingRef = ref(window.firebaseRtdb, `typing/${activeChatId}/${uid}`);
    set(typingRef, true).catch(() => {});
    onDisconnect(typingRef).remove();

    if (typingIdleTimer) clearTimeout(typingIdleTimer);
    typingIdleTimer = setTimeout(stopTypingIndicator, TYPING_IDLE_MS);
}

function stopTypingIndicator() {
    if (typingIdleTimer) { clearTimeout(typingIdleTimer); typingIdleTimer = null; }
    if (!activeChatId || !rtdbReady()) return;
    const uid = window.firebaseAuth?.currentUser?.uid;
    if (!uid) return;
    const { ref, remove } = window.rtdbFns;
    remove(ref(window.firebaseRtdb, `typing/${activeChatId}/${uid}`)).catch(() => {});
}

chatMessageInput?.addEventListener('input', notifyTyping);
chatMessageInput?.addEventListener('blur', stopTypingIndicator);

// ===== Chat / Messages =====

// Data model:
//   chats/{chatId}: { participants: [uid, uid], participant_labels: {uid: name},
//     type: 'listing' | 'support', crop_id, crop_name, last_message,
//     last_message_enc, last_message_at, last_sender_id, unread_by: [uid, ...],
//     created_at }
//   chats/{chatId}/messages/{messageId}:
//     encrypted:  { sender_id, created_at, enc: true, ciphertext, iv }
//     plain text: { sender_id, created_at, enc: false, text }
//   (see the E2EE module above for how ciphertext/iv are produced)
//
// Chat IDs are deterministic rather than randomly generated, so opening an
// existing conversation never creates a duplicate:
//   - listing chats: `listing_${cropId}_${buyerUid}` (one thread per buyer
//     per listing; the farmer side is whoever submitted that crop)
//   - support chats: `support_${uid}` (one thread per user with the admin)

// Starts (or restarts) a live subscription to every chat the signed-in
// user is part of. Kept running for the whole session so the unread badge
// updates in real time even while the Messages modal is closed.
function subscribeToChats(uid) {
    if (chatsUnsubscribe) { chatsUnsubscribe(); chatsUnsubscribe = null; }
    const db = window.firebaseDb;
    const { collection, query, where, orderBy, onSnapshot } = window.dbFns;

    const q = query(collection(db, 'chats'), where('participants', 'array-contains', uid), orderBy('last_message_at', 'desc'));
    chatsUnsubscribe = onSnapshot(q, (snap) => {
        cachedChats = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        updateChatBadge(uid);
        if (messagesModal?.classList.contains('active') && !chatListView.hidden) {
            renderChatList(uid);
        }
    }, (err) => {
        console.error('Chat list listener failed', err);
    });
}

// --- Small presentation helpers for the chat UI ---
const CHAT_AVATAR_COLORS = ['#0072c6', '#15803d', '#b45309', '#7c3aed', '#be185d', '#0f766e'];
function getChatAvatarColor(seed) {
    const str = String(seed || '?');
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return CHAT_AVATAR_COLORS[Math.abs(hash) % CHAT_AVATAR_COLORS.length];
}
function getChatInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}
function chatAvatarHtml(name, seed) {
    return `<div class="chat-avatar-circle" style="background:${getChatAvatarColor(seed || name)}">${escapeHtml(getChatInitials(name))}</div>`;
}
// Same as chatAvatarHtml, but renders an actual photo when one is available
// (currently only ever the signed-in user's own photoURL — other users'
// avatars stay initials-only since photo_url isn't in a publicly-readable
// Firestore doc). Falls back to the initials circle otherwise.
function avatarHtml(name, seed, photoUrl) {
    if (photoUrl) {
        return `<img class="avatar-photo" src="${escapeHtml(photoUrl)}" alt="${escapeHtml(name || 'Profile photo')}">`;
    }
    return chatAvatarHtml(name, seed);
}
// Compact relative time for the conversation list (e.g. "5m", "Yesterday").
function formatChatListTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diffMin = Math.floor((now - date) / 60000);
    if (diffMin < 1) return 'now';
    if (diffMin < 60) return `${diffMin}m`;
    if (date.toDateString() === now.toDateString()) return `${Math.floor(diffMin / 60)}h`;
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    if (diffMin < 60 * 24 * 7) return date.toLocaleDateString(undefined, { weekday: 'short' });
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
// Full clock time for individual message bubbles (e.g. "10:24 AM").
function formatChatMessageTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function unsubscribeFromChats() {
    if (chatsUnsubscribe) { chatsUnsubscribe(); chatsUnsubscribe = null; }
    if (threadUnsubscribe) { threadUnsubscribe(); threadUnsubscribe = null; }
    cachedChats = [];
    activeChatId = null;
}

function updateChatBadge(uid) {
    const chatBadge = document.getElementById('chatBadge');
    if (!chatBadge) return;
    const unreadCount = cachedChats.filter((c) => Array.isArray(c.unread_by) && c.unread_by.includes(uid)).length;
    if (unreadCount > 0) {
        chatBadge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
        chatBadge.hidden = false;
    } else {
        chatBadge.hidden = true;
    }
}

function openMessagesModal() {
    if (!messagesModal) return;
    const chatEmptyState = document.getElementById('chatEmptyState');
    // Always land back on the conversation list when the modal is (re)opened
    // — on mobile this is the only view anyway; on desktop the sidebar is
    // visible regardless (see the [hidden] override in the >=720px media
    // query), so this mainly resets the main pane back to the placeholder.
    chatListView.hidden = false;
    chatThreadView.hidden = true;
    if (chatEmptyState) chatEmptyState.hidden = false;
    if (threadUnsubscribe) { threadUnsubscribe(); threadUnsubscribe = null; }
    activeChatId = null;

    const uid = window.firebaseAuth?.currentUser?.uid;
    renderChatList(uid);
    messagesModal.classList.add('active');
    messagesModal.classList.remove('chat-maximized', 'chat-minimized');
    setChatMaximizeIcon(false);
}

function closeMessagesModal() {
    if (threadUnsubscribe) { threadUnsubscribe(); threadUnsubscribe = null; }
    stopTypingIndicator();
    clearThreadPresence();
    activeChatId = null;
    messagesModal?.classList.remove('active', 'chat-maximized', 'chat-minimized');
}

// Window controls — minimize collapses the chat to a small docked bar
// (like a real messaging widget) without losing the conversation; maximize
// forces a true full-viewport view regardless of screen size, useful when
// the default modal feels cramped. Only one state applies at a time.
function setChatMaximizeIcon(isMaximized) {
    const btn = document.getElementById('chatMaximizeBtn');
    if (!btn) return;
    btn.innerHTML = isMaximized ? '<i data-lucide="minimize-2"></i>' : '<i data-lucide="maximize-2"></i>';
    btn.setAttribute('aria-label', isMaximized ? 'Restore' : 'Maximize');
}

document.getElementById('chatMinimizeBtn')?.addEventListener('click', () => {
    if (!messagesModal) return;
    const nowMinimized = messagesModal.classList.toggle('chat-minimized');
    if (nowMinimized) {
        messagesModal.classList.remove('chat-maximized');
        setChatMaximizeIcon(false);
    }
});

document.getElementById('chatMaximizeBtn')?.addEventListener('click', () => {
    if (!messagesModal) return;
    const nowMaximized = messagesModal.classList.toggle('chat-maximized');
    if (nowMaximized) messagesModal.classList.remove('chat-minimized');
    setChatMaximizeIcon(nowMaximized);
});

// While minimized, clicking anywhere on the title bar (but not its buttons)
// restores the window — matches how real minimized chat widgets behave.
document.querySelector('#messagesModal .chat-window-titlebar')?.addEventListener('click', (e) => {
    if (!messagesModal?.classList.contains('chat-minimized')) return;
    if (e.target.closest('.chat-win-btn')) return;
    messagesModal.classList.remove('chat-minimized');
});

function renderChatList(uid) {
    // Kept in sync here, rather than a second Firestore listener, since
    // this function already re-runs on every chats snapshot via
    // subscribeToChats(uid). The profile page's elements are always in the
    // DOM (it's a static section, just hidden when not active), so this
    // keeps its "Conversations" stat and recent-chats list live even while
    // the profile page isn't the one currently showing.
    renderProfileActivityChats(uid);

    if (!chatListContainer) return;
    clearChatListPresence();
    if (!cachedChats.length) {
        chatListContainer.innerHTML = '<div class="chat-list-empty"><i data-lucide="message-circle"></i><p>No conversations yet</p></div>';
        return;
    }
    chatListContainer.innerHTML = '';
    cachedChats.forEach((chat) => {
        const otherUid = (chat.participants || []).find((p) => p !== uid);
        const fallbackLabel = chat.type === 'support' ? 'Support' : 'User';
        const otherLabelRaw = (chat.participant_labels && chat.participant_labels[otherUid]) || fallbackLabel;
        const otherLabel = escapeHtml(otherLabelRaw);
        const isUnread = Array.isArray(chat.unread_by) && chat.unread_by.includes(uid);
        const isActive = chat.id === activeChatId;
        const lastMsg = chat.last_message_enc
            ? '🔒 Encrypted message'
            : escapeHtml(chat.last_message || 'No messages yet');
        const contextLabel = chat.type === 'listing' && chat.crop_name ? escapeHtml(chat.crop_name) : (chat.type === 'support' ? 'Support' : '');
        const timeLabel = escapeHtml(formatChatListTime(chat.last_message_at));

        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'chat-list-item'
            + (isUnread ? ' chat-list-item-unread' : '')
            + (isActive ? ' chat-list-item-active' : '');
        row.innerHTML = `
            <span class="chat-avatar-wrap">
                ${chatAvatarHtml(otherLabelRaw, otherUid || chat.id)}
                <span class="presence-dot" hidden></span>
            </span>
            <div class="chat-list-item-main">
                <div class="chat-list-item-top">
                    <span class="chat-list-item-name">${otherLabel}</span>
                    <span class="chat-list-item-time">${timeLabel}</span>
                </div>
                ${contextLabel ? `<span class="chat-list-item-context">${contextLabel}</span>` : ''}
                <span class="chat-list-item-preview">${lastMsg}</span>
            </div>
            ${isUnread ? '<span class="chat-list-item-dot"></span>' : ''}
        `;
        row.addEventListener('click', () => openChatThread(chat.id));
        chatListContainer.appendChild(row);

        if (otherUid) {
            const dotEl = row.querySelector('.presence-dot');
            const previewEl = row.querySelector('.chat-list-item-preview');
            const statusUnsub = subscribeToPresence(otherUid, (statusVal) => {
                if (!dotEl) return;
                const isOnline = statusVal?.state === 'online';
                dotEl.hidden = false;
                dotEl.classList.toggle('presence-dot-online', isOnline);
            });
            const typingUnsub = subscribeToTyping(chat.id, otherUid, (isTyping) => {
                if (!previewEl) return;
                if (isTyping) {
                    previewEl.textContent = 'Typing…';
                    previewEl.classList.add('chat-list-item-typing');
                } else {
                    previewEl.textContent = lastMsg.replace(/<[^>]*>/g, '') || 'No messages yet';
                    previewEl.classList.remove('chat-list-item-typing');
                }
            });
            chatListPresenceUnsubs.push(statusUnsub, typingUnsub);
        }
    });
}

async function openChatThread(chatId) {
    if (!messagesModal) return;
    if (activeChatId && activeChatId !== chatId) stopTypingIndicator(); // leaving the old chat
    const chatEmptyState = document.getElementById('chatEmptyState');
    chatListView.hidden = true; // mobile: switches away from the list; desktop: overridden to stay visible via CSS
    chatThreadView.hidden = false;
    if (chatEmptyState) chatEmptyState.hidden = true;
    activeChatId = chatId;

    const uid = window.firebaseAuth?.currentUser?.uid;
    const chatMeta = cachedChats.find((c) => c.id === chatId);
    const otherUid = chatMeta ? (chatMeta.participants || []).find((p) => p !== uid) : null;
    const otherLabel = (chatMeta?.participant_labels && chatMeta.participant_labels[otherUid]) || (chatMeta?.type === 'support' ? 'Support' : 'User');
    chatThreadTitle.textContent = otherLabel;
    const chatThreadAvatar = document.getElementById('chatThreadAvatar');
    if (chatThreadAvatar) chatThreadAvatar.innerHTML = chatAvatarHtml(otherLabel, otherUid || chatId);
    chatThreadSubtitle.textContent = chatMeta?.type === 'listing' && chatMeta.crop_name
        ? `About: ${chatMeta.crop_name}`
        : (chatMeta?.type === 'support' ? 'Support conversation' : '');

    // Presence dot + "Online" / "Last seen…" / "Typing…" line in the thread
    // header. Torn down and re-subscribed every time a different thread is
    // opened so we're never listening to the wrong conversation's typing
    // state.
    clearThreadPresence();
    const presenceDot = document.getElementById('chatThreadPresenceDot');
    const presenceLine = document.getElementById('chatThreadPresence');
    let lastKnownStatus = null;
    let isOtherTyping = false;
    function renderThreadPresenceLine() {
        if (!presenceLine) return;
        if (isOtherTyping) {
            presenceLine.textContent = 'Typing…';
            presenceLine.className = 'chat-thread-presence chat-thread-presence-typing';
            presenceLine.hidden = false;
            return;
        }
        if (!lastKnownStatus) { presenceLine.hidden = true; return; }
        const isOnline = lastKnownStatus.state === 'online';
        presenceLine.textContent = isOnline ? 'Online' : formatLastSeen(lastKnownStatus);
        presenceLine.className = 'chat-thread-presence' + (isOnline ? ' chat-thread-presence-online' : '');
        presenceLine.hidden = false;
    }
    if (otherUid) {
        threadStatusUnsub = subscribeToPresence(otherUid, (statusVal) => {
            lastKnownStatus = statusVal;
            if (presenceDot) {
                const isOnline = statusVal?.state === 'online';
                presenceDot.hidden = false;
                presenceDot.classList.toggle('presence-dot-online', isOnline);
            }
            renderThreadPresenceLine();
        });
        threadTypingUnsub = subscribeToTyping(chatId, otherUid, (isTyping) => {
            isOtherTyping = isTyping;
            renderThreadPresenceLine();
        });
    } else if (presenceDot) {
        presenceDot.hidden = true;
    }

    // Figure out whether we can actually encrypt/decrypt for this
    // conversation before loading any messages, so the lock badge is
    // accurate the moment the thread appears.
    const sharedKey = await getSharedKeyForChat(chatId, otherUid);
    updateChatEncryptionBadge(!!sharedKey);

    // Refresh the list now so the newly-opened conversation gets the
    // active-state highlight immediately (relevant on desktop, where the
    // sidebar stays visible alongside the thread).
    renderChatList(uid);

    // Mark as read — removing our own uid from unread_by. Harmless if we're
    // already not in the array.
    try {
        const db = window.firebaseDb;
        const { doc, setDoc, arrayRemove } = window.dbFns;
        await setDoc(doc(db, 'chats', chatId), { unread_by: arrayRemove(uid) }, { merge: true });
    } catch (err) {
        console.warn('Could not mark chat as read', err);
    }

    if (threadUnsubscribe) { threadUnsubscribe(); threadUnsubscribe = null; }
    const db = window.firebaseDb;
    const { collection, query, orderBy, onSnapshot } = window.dbFns;
    chatMessagesContainer.innerHTML = '<p class="text-muted">Loading…</p>';

    const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('created_at', 'asc'));
    threadUnsubscribe = onSnapshot(q, (snap) => {
        const msgs = snap.docs.map((d) => d.data());
        renderChatMessages(msgs, uid, sharedKey);
    }, (err) => {
        console.error('Message listener failed', err);
        chatMessagesContainer.innerHTML = '<p class="text-muted">Could not load messages.</p>';
    });
}

async function renderChatMessages(msgs, uid, sharedKey) {
    if (!chatMessagesContainer) return;
    if (!msgs.length) {
        chatMessagesContainer.innerHTML = '<div class="chat-messages-empty"><i data-lucide="message-circle"></i><p>Say hello 👋</p></div>';
        return;
    }

    // Decrypt everything up front (in parallel) so the thread renders in
    // one clean pass rather than messages popping in one at a time.
    const decorated = await Promise.all(msgs.map(async (m) => {
        if (!m.enc) return { ...m, displayText: m.text || '' };
        if (!sharedKey) return { ...m, displayText: '🔒 Encrypted message — open this chat on the device you set it up on to read it' };
        try {
            const text = await decryptChatText(sharedKey, m.ciphertext, m.iv);
            return { ...m, displayText: text };
        } catch (err) {
            console.warn('Could not decrypt message', err);
            return { ...m, displayText: '🔒 Unable to decrypt this message' };
        }
    }));

    chatMessagesContainer.innerHTML = '';
    decorated.forEach((m) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'chat-bubble-wrapper ' + (m.sender_id === uid ? 'chat-bubble-wrapper-mine' : 'chat-bubble-wrapper-theirs');

        const bubble = document.createElement('div');
        // textContent (not innerHTML) so message text never needs
        // escaping — it can't be interpreted as markup either way.
        bubble.className = 'chat-bubble ' + (m.sender_id === uid ? 'chat-bubble-mine' : 'chat-bubble-theirs');
        bubble.textContent = m.displayText;

        const time = document.createElement('span');
        time.className = 'chat-bubble-time';
        time.textContent = formatChatMessageTime(m.created_at);

        wrapper.appendChild(bubble);
        wrapper.appendChild(time);
        chatMessagesContainer.appendChild(wrapper);
    });
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

async function handleSendChatMessage(e) {
    e.preventDefault();
    const text = chatMessageInput.value.trim();
    if (!text || !activeChatId) return;

    const auth = window.firebaseAuth;
    const user = auth?.currentUser;
    if (!user) return;

    const db = window.firebaseDb;
    const { collection, doc, setDoc, arrayUnion } = window.dbFns;

    chatMessageInput.value = '';
    stopTypingIndicator();
    try {
        const chatMeta = cachedChats.find((c) => c.id === activeChatId);
        const otherUid = chatMeta ? (chatMeta.participants || []).find((p) => p !== user.uid) : null;
        const sharedKey = await getSharedKeyForChat(activeChatId, otherUid);

        const msgRef = doc(collection(db, 'chats', activeChatId, 'messages'));
        const base = { sender_id: user.uid, created_at: new Date().toISOString() };
        const updatePayload = {
            last_message_at: new Date().toISOString(),
            last_sender_id: user.uid
        };

        if (sharedKey) {
            const { ciphertext, iv } = await encryptChatText(sharedKey, text);
            await setDoc(msgRef, { ...base, enc: true, ciphertext, iv });
            // Never store the plain-text preview for an encrypted chat —
            // the list view shows a generic lock placeholder instead.
            updatePayload.last_message = '';
            updatePayload.last_message_enc = true;
        } else {
            await setDoc(msgRef, { ...base, enc: false, text });
            updatePayload.last_message = text;
            updatePayload.last_message_enc = false;
        }

        if (otherUid) updatePayload.unread_by = arrayUnion(otherUid);

        await setDoc(doc(db, 'chats', activeChatId), updatePayload, { merge: true });
    } catch (err) {
        console.error('Failed to send message', err);
        triggerToast(mapFirebaseError(err));
        chatMessageInput.value = text; // restore so nothing is lost
    }
}

// Looks up (or creates, on first contact) the deterministic chat doc for a
// listing conversation or a support conversation, then opens it directly.
async function openOrCreateChat({ otherUid, otherLabel, type, cropId = null, cropName = null }) {
    const auth = window.firebaseAuth;
    const user = auth?.currentUser;
    if (!user) {
        triggerToast('Please sign in first.');
        return;
    }
    if (!user.emailVerified) {
        showVerifyEmailPrompt(user);
        return;
    }

    const db = window.firebaseDb;
    const { doc, getDoc, setDoc } = window.dbFns;
    const chatId = type === 'support' ? `support_${user.uid}` : `listing_${cropId}_${user.uid}`;

    try {
        const chatRef = doc(db, 'chats', chatId);
        const snap = await getDoc(chatRef);
        if (!snap.exists()) {
            const myLabel = await getFirstName(user) || user.email || 'User';
            await setDoc(chatRef, {
                participants: [user.uid, otherUid],
                participant_labels: { [user.uid]: myLabel, [otherUid]: otherLabel },
                type,
                crop_id: cropId,
                crop_name: cropName,
                last_message: '',
                last_message_at: new Date().toISOString(),
                last_sender_id: '',
                unread_by: [],
                created_at: new Date().toISOString()
            });
        }
        openMessagesModal();
        await openChatThread(chatId);
    } catch (err) {
        console.error('Failed to open chat', err);
        triggerToast(mapFirebaseError(err));
    }
}

// ===== Profile management =====
// Reads/writes the same users/{uid} doc that already backs getFirstName()
// and the E2EE public key lookup, so nothing here changes the data model —
// it only adds a UI for editing full_name (kept in sync with the Auth
// displayName, same as the registration flow does) plus phone, location,
// and a photo_url field for the avatar upload. Firestore rules already
// cover all of this: the existing `users/{userId}: allow read, write: if
// auth.uid == userId` rule is exactly what a "read/write your own profile"
// form needs, so no rules changes were required for any of it.
//
// Shown as a full page (toggled the same way dashboardApp/landingPage
// already are) rather than a modal, so it has room for the avatar,
// account details, activity summary, and danger zone side by side.

function showProfileView(user) {
    if (!profileView || !user) return;
    document.getElementById('staticPageContainer').style.display = 'none';
    document.getElementById('landingSections').style.display = 'none';
    landingPage.style.display = 'none';
    dashboardApp.style.display = 'none';
    profileView.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadProfileView(user);
}
// Exposed globally so the footer navigation logic in index.html (showPage,
// goBackFromStatic) can restore the profile view after visiting a static
// page like Privacy/Terms/Support/Contact, the same way window.showDashboardView
// already lets it restore the dashboard.
window.showProfileView = showProfileView;

async function loadProfileView(user) {
    const db = window.firebaseDb;
    const { doc, getDoc } = window.dbFns;

    let profileData = {};
    try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) profileData = snap.data();
    } catch (err) {
        console.warn('Could not load profile', err);
    }

    const displayName = user.displayName || profileData.full_name || '';
    const photoUrl = profileData.photo_url || user.photoURL || '';

    // Header
    const avatarEl = document.getElementById('profileAvatarLg');
    if (avatarEl) avatarEl.innerHTML = avatarHtml(displayName || user.email || 'User', user.uid, photoUrl);
    document.getElementById('profileHeaderName').textContent = displayName || user.email || 'User';
    const isAdmin = user.uid === ADMIN_UID;
    document.getElementById('profileRoleBadge').textContent = isAdmin ? 'Administrator' : 'Member';

    // Editable fields
    document.getElementById('profileFullName').value = displayName;
    document.getElementById('profilePhone').value = profileData.phone || '';
    document.getElementById('profileLocation').value = profileData.location || '';

    // Account (read-only) fields
    document.getElementById('profileEmailValue').textContent = user.email || '—';
    const verifiedBadge = document.getElementById('profileEmailVerifiedBadge');
    verifiedBadge.textContent = user.emailVerified ? 'Verified' : 'Not verified';
    verifiedBadge.className = 'profile-verified-badge ' + (user.emailVerified ? 'profile-verified-badge-yes' : 'profile-verified-badge-no');
    document.getElementById('profileResendVerificationBtn').hidden = !!user.emailVerified;

    const isPasswordAccount = (user.providerData || []).some((p) => p.providerId === 'password');
    document.getElementById('profileSignInMethod').textContent = isPasswordAccount ? 'Email & Password' : 'Google';
    document.getElementById('profileChangePasswordBtn').hidden = !isPasswordAccount;
    document.getElementById('deleteAccountPasswordGroup').hidden = !isPasswordAccount;

    const memberSinceEl = document.getElementById('profileMemberSince');
    const createdTime = user.metadata?.creationTime;
    memberSinceEl.textContent = createdTime
        ? new Date(createdTime).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
        : (profileData.created_at ? new Date(profileData.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '—');

    loadProfileActivity(user.uid);

    // Load KYC status badge + summary (mobile money verification).
    // Runs a live onSnapshot listener so approval/rejection reflects
    // immediately without a page reload.
    try {
        loadKycStatus(user);
    } catch (err) {
        console.warn('KYC status load skipped', err);
    }
}

// --- Activity summary: listing counts + a live view of recent conversations ---
async function loadProfileActivity(uid) {
    const db = window.firebaseDb;
    const { collection, query, where, getDocs } = window.dbFns;

    try {
        const snap = await getDocs(query(collection(db, 'crops'), where('submitted_by', '==', uid)));
        const items = snap.docs.map((d) => d.data());
        document.getElementById('profileStatListings').textContent = items.length;
        document.getElementById('profileStatApproved').textContent = items.filter((i) => i.status === 'approved').length;
        document.getElementById('profileStatPending').textContent = items.filter((i) => i.status === 'pending').length;
    } catch (err) {
        console.warn('Failed to load listing stats', err);
    }

    // cachedChats is kept live by subscribeToChats(uid), started at sign-in
    // (see onAuthStateChanged). renderChatList() already re-renders on every
    // chats snapshot and also calls renderProfileActivityChats() at the end
    // of its own body (see below), so the conversation count/list here stay
    // in sync automatically without a second Firestore listener — this call
    // just paints the current data immediately on page load.
    renderProfileActivityChats(uid);
}

function renderProfileActivityChats(uid) {
    const statEl = document.getElementById('profileStatChats');
    const listEl = document.getElementById('profileRecentChats');
    if (!statEl || !listEl) return;
    statEl.textContent = cachedChats.length;
    listEl.innerHTML = '';
    cachedChats.slice(0, 3).forEach((chat) => {
        const otherUid = (chat.participants || []).find((p) => p !== uid);
        const label = (chat.participant_labels && chat.participant_labels[otherUid]) || (chat.type === 'support' ? 'Support' : 'User');
        const preview = chat.last_message_enc ? '🔒 Encrypted message' : (chat.last_message || 'No messages yet');
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'profile-recent-chat-row';
        row.innerHTML = `
            ${chatAvatarHtml(label, otherUid || chat.id)}
            <div>
                <div class="profile-recent-chat-name">${escapeHtml(label)}</div>
                <div class="profile-recent-chat-preview">${escapeHtml(preview)}</div>
            </div>
        `;
        row.addEventListener('click', () => {
            messagesModal?.classList.add('active');
            openChatThread(chat.id);
        });
        listEl.appendChild(row);
    });
    if (!cachedChats.length) {
        listEl.innerHTML = '<p class="text-muted">No conversations yet.</p>';
    }
}

document.getElementById('profileBackBtn')?.addEventListener('click', () => window.showDashboardView?.());

profileForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const auth = window.firebaseAuth;
    const user = auth?.currentUser;
    if (!user) return;

    const fullName = document.getElementById('profileFullName').value.trim();
    const phone = document.getElementById('profilePhone').value.trim();
    const location = document.getElementById('profileLocation').value;

    if (!fullName) {
        triggerToast('Please enter your name.');
        return;
    }

    try {
        const { updateProfile } = window.authFns;
        const db = window.firebaseDb;
        const { doc, setDoc } = window.dbFns;

        // Keep the Auth profile's displayName and the Firestore full_name
        // in sync, same pairing the registration flow writes — anything
        // that reads either one (navbar greeting, chat participant labels,
        // getFirstName()) stays correct regardless of which it reads from.
        const nameChanged = fullName !== (user.displayName || '');
        if (nameChanged) {
            await updateProfile(user, { displayName: fullName });
        }
        await setDoc(doc(db, 'users', user.uid), {
            full_name: fullName,
            phone: phone || null,
            location: location || null
        }, { merge: true });

        // Refresh the navbar greeting/avatar immediately if the name
        // changed, rather than waiting for the next sign-in.
        if (nameChanged) await window.renderAuthedNav?.(user);

        triggerToast('Profile updated.');
    } catch (err) {
        console.error('Failed to update profile', err);
        triggerToast(mapFirebaseError(err));
    }
});

document.getElementById('profileResendVerificationBtn')?.addEventListener('click', async () => {
    const user = window.firebaseAuth?.currentUser;
    if (!user) return;
    try {
        const { sendEmailVerification } = window.authFns;
        await sendEmailVerification(user);
        triggerToast('Verification email sent. Check your inbox.');
    } catch (err) {
        console.error('Failed to resend verification email', err);
        triggerToast(mapFirebaseError(err));
    }
});

document.getElementById('profileChangePasswordBtn')?.addEventListener('click', async () => {
    const user = window.firebaseAuth?.currentUser;
    if (!user?.email) return;
    try {
        const { sendPasswordResetEmail } = window.authFns;
        await sendPasswordResetEmail(window.firebaseAuth, user.email);
        triggerToast(`Password reset link sent to ${user.email}.`);
    } catch (err) {
        console.error('Failed to send password reset email', err);
        triggerToast(mapFirebaseError(err));
    }
});

// --- Profile photo upload ---
// Firebase Storage requires the Blaze (pay-as-you-go) plan, so instead of
// uploading the file to Storage, we resize it down client-side with a
// <canvas> and save the resulting JPEG as a base64 data URL directly on the
// users/{uid} Firestore doc (photo_url field). Firestore documents cap out
// at 1MB, so we resize to a small square thumbnail (128px) and compress
// fairly aggressively (quality 0.7) — plenty for an avatar, and comfortably
// under that limit (typically 15-30KB as a base64 string).
//
// NOTE: we deliberately do NOT call authFns.updateProfile(user, { photoURL })
// here. Firebase Auth's photoURL field isn't meant to hold multi-KB data
// URIs and can silently misbehave or be rejected with long values, so the
// Firestore doc is the single source of truth for uploaded avatars.
// Google Sign-In users keep their real Google photoURL on the Auth user
// object, and avatarHtml()/loadProfileView() already prefer user.photoURL
// over profileData.photo_url, so nothing else needs to change for them.
function resizeImageToDataUrl(file, maxDim = 128, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));

            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);

            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Could not read image file'));
        };
        img.src = objectUrl;
    });
}

document.getElementById('profileAvatarUploadBtn')?.addEventListener('click', () => {
    document.getElementById('profileAvatarInput')?.click();
});

document.getElementById('profileAvatarInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    const user = window.firebaseAuth?.currentUser;
    if (!user) return;

    if (!file.type.startsWith('image/')) {
        triggerToast('Please choose an image file.');
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        triggerToast('Image must be under 5MB.');
        return;
    }

    const avatarEl = document.getElementById('profileAvatarLg');
    const previousHtml = avatarEl?.innerHTML;
    // Show the picked image immediately (before resizing/saving finishes) so
    // the UI feels instant; reverts to the previous avatar if it fails.
    const localPreviewUrl = URL.createObjectURL(file);
    if (avatarEl) avatarEl.innerHTML = `<img class="avatar-photo" src="${localPreviewUrl}" alt="Profile photo">`;

    try {
        const dataUrl = await resizeImageToDataUrl(file);

        // ~1.37 bytes per base64 char; bail out rather than risk a Firestore
        // write failure if something unusually large slips through.
        if (dataUrl.length * 0.75 > 900 * 1024) {
            throw new Error('Resized image is still too large to save.');
        }

        const db = window.firebaseDb;
        const { doc, setDoc } = window.dbFns;
        await setDoc(doc(db, 'users', user.uid), { photo_url: dataUrl }, { merge: true });

        if (avatarEl) avatarEl.innerHTML = `<img class="avatar-photo" src="${dataUrl}" alt="Profile photo">`;
        await window.renderAuthedNav?.(user); // updates the navbar avatar too
        triggerToast('Profile photo updated.');
    } catch (err) {
        console.error('Failed to save profile photo', err);
        triggerToast(err?.message || mapFirebaseError(err));
        if (avatarEl && previousHtml) avatarEl.innerHTML = previousHtml;
    } finally {
        URL.revokeObjectURL(localPreviewUrl);
    }
});

// ===================================================================
// KYC — Mobile Money Verification (Orange Money, Afrimoney, Qcell Money)
// ===================================================================
//
// Data model (Firestore only — no Firebase Storage used):
//   users/{uid} → kyc_status: 'not_started' | 'pending' | 'approved' | 'rejected'
//                 kyc_provider: 'orange' | 'africell' | 'qcell'
//                 kyc_momo_number: string
//                 kyc_id_type: string
//                 kyc_submitted_at: timestamp
//                 kyc_approved_at: timestamp
//                 kyc_rejection_reason: string (when rejected)
//                 kyc_app_id: string (reference to the application doc)
//   users/{uid}/kyc_applications/{autoId} → full application snapshot
//     { full_name, dob, region, address, provider, momo_number,
//       momo_name, id_type, id_number, id_front_url, id_back_url,
//       status, submitted_at, reviewed_at, review_note, reviewed_by }
//
// ID document images (front + back of ID) are stored as compressed
// base64 data URLs directly in the Firestore application document
// (id_front_url / id_back_url fields) — the same approach used for user
// avatars (photo_url). Images are compressed to 800px max dimension at
// 0.65 JPEG quality via resizeImageToDataUrl(), which keeps each photo
// well under Firestore's 1MB document limit. This means NO Firebase
// Storage rules are needed — only Firestore rules.
//
// Firestore rules needed (in addition to existing users/{uid} rules):
//   match /users/{userId}/kyc_applications/{appId} {
//     allow read: if request.auth.uid == userId
//                  || request.auth.uid == ADMIN_UID;
//     allow create: if request.auth.uid == userId;
//     allow update: if request.auth.uid == ADMIN_UID;
//     allow delete: if false; // preserve audit trail
//   }
//   // Admin reads all pending KYC: the client queries the users
//   // collection with a kyc_status == 'pending' filter, which requires:
//   match /users/{userId} {
//     allow read: if request.auth.uid == userId
//                  || request.auth.uid == ADMIN_UID;
//     // (write rule stays: auth.uid == userId)
//   }
// See firestore_kyc_rules.txt for the complete, copy-paste-ready rules.

const KYC_PROVIDERS = {
    orange:   { label: 'Orange Money',  short: 'Orange',   color: '#f97316' },
    africell: { label: 'Afrimoney',     short: 'Africell',  color: '#0066b3' },
    qcell:    { label: 'Qcell Money',   short: 'Qcell',     color: '#7c3aed' }
};

const KYC_ID_TYPES = {
    national_id:      'National ID Card',
    voter_id:         "Voter's Registration Card",
    driving_license:  "Driver's License",
    passport:         'Sierra Leone Passport',
    nios_card:        'NASSIT / NIOS Card'
};

const kycModal = document.getElementById('kycModal');
const kycForm = document.getElementById('kycForm');
let kycCurrentStep = 1;
let kycUploadedFiles = { front: null, back: null }; // { file, dataUrl }
let kycUnsubscribe = null; // onSnapshot listener for live status updates

// --- KYC status loader — called from loadProfileView() ---
async function loadKycStatus(user) {
    const db = window.firebaseDb;
    const { doc, getDoc } = window.dbFns;

    let kycStatus = 'not_started';
    let kycData = {};

    try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) {
            kycStatus = snap.data().kyc_status || 'not_started';
            kycData = snap.data();
        }
    } catch (err) {
        console.warn('Could not load KYC status', err);
    }

    renderKycStatus(kycStatus, kycData);

    // Set up a real-time listener so the status updates live if the
    // admin approves/rejects while the user is viewing their profile.
    if (kycUnsubscribe) kycUnsubscribe();
    try {
        const { onSnapshot } = window.dbFns;
        kycUnsubscribe = onSnapshot(doc(db, 'users', user.uid), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                renderKycStatus(data.kyc_status || 'not_started', data);
            }
        });
    } catch (err) {
        console.warn('Could not set up KYC listener', err);
    }
}
window.loadKycStatus = loadKycStatus;

function renderKycStatus(status, data) {
    const badge = document.getElementById('kycStatusBadge');
    const summary = document.getElementById('kycSummary');
    const startBtn = document.getElementById('kycStartBtn');
    const resubmitBtn = document.getElementById('kycResubmitBtn');
    const rejectionNote = document.getElementById('kycRejectionNote');
    const rejectionText = document.getElementById('kycRejectionText');

    const statusConfig = {
        'not_started': { label: 'Not Started', class: 'kyc-status-not-started' },
        'pending':     { label: 'Under Review',  class: 'kyc-status-pending' },
        'approved':    { label: 'Verified',     class: 'kyc-status-approved' },
        'rejected':    { label: 'Rejected',     class: 'kyc-status-rejected' }
    };

    const cfg = statusConfig[status] || statusConfig['not_started'];
    badge.textContent = cfg.label;
    badge.className = 'kyc-status-badge ' + cfg.class;

    if (status === 'not_started') {
        summary.hidden = true;
        startBtn.hidden = false;
        resubmitBtn.hidden = true;
        rejectionNote.hidden = true;
    } else if (status === 'approved') {
        summary.hidden = false;
        startBtn.hidden = true;
        resubmitBtn.hidden = true;
        rejectionNote.hidden = true;
        fillKycSummary(data);
    } else if (status === 'pending') {
        summary.hidden = false;
        startBtn.hidden = true;
        resubmitBtn.hidden = true;
        rejectionNote.hidden = true;
        fillKycSummary(data);
    } else if (status === 'rejected') {
        summary.hidden = false;
        startBtn.hidden = true;
        resubmitBtn.hidden = false;
        rejectionNote.hidden = false;
        rejectionText.textContent = data.kyc_rejection_reason || 'No reason provided. Please review your submission and try again.';
        fillKycSummary(data);
    }
}

function fillKycSummary(data) {
    const providerLabel = KYC_PROVIDERS[data.kyc_provider]?.label || '—';
    document.getElementById('kycSummaryProvider').textContent = providerLabel;
    document.getElementById('kycSummaryPhone').textContent = data.kyc_momo_number || '—';
    document.getElementById('kycSummaryIdType').textContent = KYC_ID_TYPES[data.kyc_id_type] || data.kyc_id_type || '—';

    const dateEl = document.getElementById('kycSummaryDate');
    if (data.kyc_submitted_at) {
        dateEl.textContent = new Date(data.kyc_submitted_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } else if (data.kyc_approved_at) {
        dateEl.textContent = 'Approved ' + new Date(data.kyc_approved_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } else {
        dateEl.textContent = '—';
    }
}

// --- KYC modal open/close ---
function openKycModal() {
    kycCurrentStep = 1;
    kycUploadedFiles = { front: null, back: null };
    resetKycForm();
    goToKycStep(1);
    if (window.lucide) lucide.createIcons();
    kycModal.classList.add('active');
}
function closeKycModal() {
    kycModal.classList.remove('active');
    resetKycForm();
}

function resetKycForm() {
    if (kycForm) kycForm.reset();
    kycUploadedFiles = { front: null, back: null };
    // Reset provider cards
    document.querySelectorAll('.kyc-provider-card').forEach(c => c.classList.remove('selected'));
    // Reset upload zones
    ['front', 'back'].forEach(side => {
        const zone = document.getElementById(side === 'front' ? 'kycUploadFront' : 'kycUploadBack');
        if (zone) {
            zone.classList.remove('has-file');
            const placeholder = zone.querySelector('.kyc-upload-placeholder');
            const preview = zone.querySelector('.kyc-upload-preview');
            if (placeholder) placeholder.hidden = false;
            if (preview) preview.hidden = true;
        }
    });
    // Reset consent checkbox
    const consent = document.getElementById('kycConsent');
    if (consent) consent.checked = false;
}

document.getElementById('kycStartBtn')?.addEventListener('click', openKycModal);
document.getElementById('kycResubmitBtn')?.addEventListener('click', openKycModal);
document.getElementById('closeKycModal')?.addEventListener('click', closeKycModal);
kycModal?.addEventListener('click', (e) => { if (e.target === kycModal) closeKycModal(); });

// --- Step navigation ---
function goToKycStep(step) {
    kycCurrentStep = step;

    // Update step indicators
    document.querySelectorAll('.kyc-step').forEach(s => {
        const sNum = parseInt(s.dataset.step, 10);
        s.classList.remove('active', 'completed');
        if (sNum < step) s.classList.add('completed');
        else if (sNum === step) s.classList.add('active');
    });

    // Update step dividers
    document.querySelectorAll('.kyc-step-divider').forEach((d, i) => {
        d.classList.toggle('completed', i < step - 1);
    });

    // Show the right panel
    document.querySelectorAll('.kyc-step-panel').forEach(p => {
        p.classList.toggle('active', parseInt(p.dataset.panel, 10) === step);
    });

    if (step === 4) populateReviewStep();
    if (window.lucide) lucide.createIcons();
}

document.querySelectorAll('.kyc-btn-next').forEach(btn => {
    btn.addEventListener('click', () => {
        const next = parseInt(btn.dataset.next, 10);
        if (validateKycStep(kycCurrentStep)) goToKycStep(next);
    });
});
document.querySelectorAll('.kyc-btn-prev').forEach(btn => {
    btn.addEventListener('click', () => goToKycStep(parseInt(btn.dataset.prev, 10)));
});
document.querySelectorAll('.kyc-review-edit').forEach(btn => {
    btn.addEventListener('click', () => goToKycStep(parseInt(btn.dataset.edit, 10)));
});

function validateKycStep(step) {
    if (step === 1) {
        const name = document.getElementById('kycFullName').value.trim();
        const dob = document.getElementById('kycDob').value;
        const region = document.getElementById('kycRegion').value;
        const address = document.getElementById('kycAddress').value.trim();
        if (!name) return triggerToast('Please enter your full legal name.'), false;
        if (!dob) return triggerToast('Please enter your date of birth.'), false;
        if (!region) return triggerToast('Please select your region.'), false;
        if (!address) return triggerToast('Please enter your residential address.'), false;
        // Check age >= 18
        const birthDate = new Date(dob);
        const age = (new Date() - birthDate) / (365.25 * 24 * 60 * 60 * 1000);
        if (age < 18) return triggerToast('You must be at least 18 years old to use mobile money services.'), false;
        if (age > 120) return triggerToast('Please enter a valid date of birth.'), false;
    }
    if (step === 2) {
        const provider = document.querySelector('input[name="kycProvider"]:checked');
        const momoNumber = document.getElementById('kycMomoNumber').value.trim();
        const momoName = document.getElementById('kycMomoName').value.trim();
        if (!provider) return triggerToast('Please select a mobile money provider.'), false;
        if (!momoNumber) return triggerToast('Please enter your mobile money account number.'), false;
        if (!momoName) return triggerToast('Please enter the registered account name.'), false;
        // Basic Sierra Leone phone validation (+232 or 0xx)
        const phoneClean = momoNumber.replace(/[\s-()]/g, '');
        if (!/^(\+?232|0)\d{6,8}$/.test(phoneClean)) {
            return triggerToast('Please enter a valid Sierra Leone phone number (e.g., +23276123456).'), false;
        }
    }
    if (step === 3) {
        const idType = document.getElementById('kycIdType').value;
        const idNumber = document.getElementById('kycIdNumber').value.trim();
        if (!idType) return triggerToast('Please select your ID document type.'), false;
        if (!idNumber) return triggerToast('Please enter your ID number.'), false;
        if (!kycUploadedFiles.front) return triggerToast('Please upload the front of your ID document.'), false;
    }
    return true;
}

// --- Provider card selection ---
document.querySelectorAll('.kyc-provider-card').forEach(card => {
    card.addEventListener('click', () => {
        document.querySelectorAll('.kyc-provider-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        const radio = card.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
    });
});

// --- Document upload handling ---
['front', 'back'].forEach(side => {
    const zoneId = side === 'front' ? 'kycUploadFront' : 'kycUploadBack';
    const inputId = side === 'front' ? 'kycIdFrontInput' : 'kycIdIdBackInput';
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(side === 'front' ? 'kycIdFrontInput' : 'kycIdBackInput');

    if (zone) {
        zone.addEventListener('click', (e) => {
            if (e.target.closest('.kyc-upload-remove')) return;
            input?.click();
        });
    }

    if (input) {
        input.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;

            if (!file.type.startsWith('image/')) {
                triggerToast('Please choose an image file (PNG, JPG, or WEBP).');
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                triggerToast('Image must be under 5MB.');
                return;
            }

            // Show loading state
            const placeholder = zone.querySelector('.kyc-upload-placeholder');
            const preview = zone.querySelector('.kyc-upload-preview');
            const previewImg = preview.querySelector('img');

            try {
                // Compress the image for Firestore storage (max 800px, quality 0.65)
                // — keeps each ID photo well under Firestore's 1MB document limit
                // (even with front + back + form fields in one doc) while
                // remaining legible for admin review.
                const dataUrl = await resizeImageToDataUrl(file, 800, 0.65);
                kycUploadedFiles[side] = { file, dataUrl };

                previewImg.src = dataUrl;
                placeholder.hidden = true;
                preview.hidden = false;
                zone.classList.add('has-file');
                if (window.lucide) lucide.createIcons();
            } catch (err) {
                console.error('Failed to process ID image', err);
                triggerToast('Could not read that image. Please try a different file.');
            }
        });
    }

    // Remove uploaded image
    const removeBtn = zone?.querySelector('.kyc-upload-remove');
    removeBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        kycUploadedFiles[side] = null;
        const placeholder = zone.querySelector('.kyc-upload-placeholder');
        const preview = zone.querySelector('.kyc-upload-preview');
        placeholder.hidden = false;
        preview.hidden = true;
        zone.classList.remove('has-file');
    });
});

// --- Review step population ---
function populateReviewStep() {
    document.getElementById('reviewFullName').textContent = document.getElementById('kycFullName').value.trim() || '—';
    document.getElementById('reviewDob').textContent = document.getElementById('kycDob').value || '—';
    document.getElementById('reviewRegion').textContent = document.getElementById('kycRegion').value || '—';
    document.getElementById('reviewAddress').textContent = document.getElementById('kycAddress').value.trim() || '—';

    const providerInput = document.querySelector('input[name="kycProvider"]:checked');
    const providerVal = providerInput?.value;
    document.getElementById('reviewProvider').textContent = providerVal ? KYC_PROVIDERS[providerVal].label : '—';
    document.getElementById('reviewMomoNumber').textContent = document.getElementById('kycMomoNumber').value.trim() || '—';
    document.getElementById('reviewMomoName').textContent = document.getElementById('kycMomoName').value.trim() || '—';

    const idTypeVal = document.getElementById('kycIdType').value;
    document.getElementById('reviewIdType').textContent = idTypeVal ? KYC_ID_TYPES[idTypeVal] : '—';
    document.getElementById('reviewIdNumber').textContent = document.getElementById('kycIdNumber').value.trim() || '—';
    document.getElementById('reviewFront').textContent = kycUploadedFiles.front ? '✓ Uploaded' : '—';
    document.getElementById('reviewBack').textContent = kycUploadedFiles.back ? '✓ Uploaded' : 'Not provided';

    if (window.lucide) lucide.createIcons();
}

// --- KYC form submission ---
kycForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Final validation
    if (!validateKycStep(1) || !validateKycStep(2) || !validateKycStep(3)) return;

    const consent = document.getElementById('kycConsent');
    if (!consent.checked) {
        triggerToast('Please confirm the consent checkbox to submit your KYC application.');
        return;
    }

    const user = window.firebaseAuth?.currentUser;
    if (!user) return;

    const submitBtn = document.getElementById('kycSubmitBtn');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Uploading...';
    if (window.lucide) lucide.createIcons();

    try {
        const db = window.firebaseDb;
        const { doc, setDoc, collection, updateDoc } = window.dbFns;
        const uid = user.uid;
        const timestamp = Date.now();

        // Upload ID document images to Firebase Storage
        const idFrontUrl = await uploadKycDocument(uid, kycUploadedFiles.front, 'front', timestamp);
        let idBackUrl = null;
        if (kycUploadedFiles.back) {
            idBackUrl = await uploadKycDocument(uid, kycUploadedFiles.back, 'back', timestamp);
        }

        // Collect form data
        const providerVal = document.querySelector('input[name="kycProvider"]:checked')?.value;
        const idTypeVal = document.getElementById('kycIdType').value;
        const applicationData = {
            uid,
            full_name: document.getElementById('kycFullName').value.trim(),
            dob: document.getElementById('kycDob').value,
            region: document.getElementById('kycRegion').value,
            address: document.getElementById('kycAddress').value.trim(),
            email: user.email || '',
            provider: providerVal,
            momo_number: document.getElementById('kycMomoNumber').value.trim(),
            momo_name: document.getElementById('kycMomoName').value.trim(),
            id_type: idTypeVal,
            id_number: document.getElementById('kycIdNumber').value.trim(),
            id_front_url: idFrontUrl,
            id_back_url: idBackUrl,
            status: 'pending',
            submitted_at: new Date().toISOString()
        };

        // Write the full application to a subcollection
        const appRef = doc(collection(db, 'users', uid, 'kyc_applications'));
        await setDoc(appRef, { ...applicationData, app_id: appRef.id });

        // Update the user's top-level doc with KYC status + summary fields
        // (used by the profile badge, the admin query, and the real-time
        // listener set up in loadKycStatus).
        await setDoc(doc(db, 'users', uid), {
            kyc_status: 'pending',
            kyc_provider: providerVal,
            kyc_momo_number: applicationData.momo_number,
            kyc_id_type: idTypeVal,
            kyc_submitted_at: applicationData.submitted_at,
            kyc_rejection_reason: null,
            kyc_app_id: appRef.id
        }, { merge: true });

        closeKycModal();
        triggerToast('KYC application submitted! We will review your documents and notify you of the result.');

        // Reload KYC status to reflect the new state
        await loadKycStatus(user);
    } catch (err) {
        console.error('Failed to submit KYC application', err);
        triggerToast(err?.message || mapFirebaseError(err) || 'Failed to submit KYC. Please try again.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
        if (window.lucide) lucide.createIcons();
    }
});

// Store a KYC document image as a base64 data URL directly in Firestore.
// Uses the compressed data URL from resizeImageToDataUrl (800px / 0.65q),
// which keeps each image well under Firestore's 1MB document limit even with
// both front + back ID photos plus all form fields in one document.
// This follows the same pattern as user avatars (photo_url) — no Firebase
// Storage required, simplifying security rules to Firestore-only.
async function uploadKycDocument(uid, fileObj, side, timestamp) {
    if (!fileObj) return null;
    // The data URL is already compressed at upload-selection time
    // (see the file-input change handler: resizeImageToDataUrl at 800px/0.65q).
    return fileObj.dataUrl;
}

// ===================================================================
// Admin KYC Review
// ===================================================================

const adminKycModal = document.getElementById('adminKycModal');
const adminKycDetailModal = document.getElementById('adminKycDetailModal');

function openAdminKycModal() { adminKycModal.classList.add('active'); loadAdminKycList(); }
function closeAdminKycModal() { adminKycModal.classList.remove('active'); }
function closeAdminKycDetailModal() { adminKycDetailModal.classList.remove('active'); }

document.getElementById('closeAdminKycModal')?.addEventListener('click', closeAdminKycModal);
document.getElementById('closeAdminKycDetailModal')?.addEventListener('click', closeAdminKycDetailModal);
adminKycModal?.addEventListener('click', (e) => { if (e.target === adminKycModal) closeAdminKycModal(); });
adminKycDetailModal?.addEventListener('click', (e) => { if (e.target === adminKycDetailModal) closeAdminKycDetailModal(); });

// Fetch all users with kyc_status === 'pending' and render the list.
// This requires the Firestore rule allowing ADMIN_UID to read all user docs.
async function loadAdminKycList() {
    const db = window.firebaseDb;
    const { collection, query, where, getDocs } = window.dbFns;
    const listEl = document.getElementById('adminKycList');

    listEl.innerHTML = '<p class="text-muted" style="text-align:center; padding: 2rem;">Loading...</p>';

    try {
        const snap = await getDocs(query(collection(db, 'users'), where('kyc_status', '==', 'pending')));
        if (snap.empty) {
            listEl.innerHTML = '<p class="text-muted" style="text-align:center; padding: 2rem;">No pending KYC applications. 🎉</p>';
            return;
        }

        listEl.innerHTML = '';
        snap.docs.forEach(d => {
            const data = d.data();
            const uid = d.id;
            const name = data.full_name || data.kyc_momo_name || data.email || 'Unknown';
            const providerInfo = KYC_PROVIDERS[data.kyc_provider] || { label: 'Unknown', color: '#666' };
            const submittedAt = data.kyc_submitted_at ? new Date(data.kyc_submitted_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

            const item = document.createElement('div');
            item.className = 'admin-kyc-item';
            item.innerHTML = `
                <div class="admin-kyc-item-avatar">${escapeHtml(name.charAt(0).toUpperCase())}</div>
                <div class="admin-kyc-item-body">
                    <div class="admin-kyc-item-name">${escapeHtml(name)}</div>
                    <div class="admin-kyc-item-meta">${escapeHtml(data.email || '—')} • Submitted ${submittedAt}</div>
                    <span class="admin-kyc-item-provider" style="background: ${providerInfo.color}20; color: ${providerInfo.color};">
                        ${escapeHtml(providerInfo.label)}
                    </span>
                </div>
                <i data-lucide="chevron-right" class="admin-kyc-item-chevron"></i>
            `;
            item.addEventListener('click', () => openAdminKycDetail(uid, data));
            listEl.appendChild(item);
        });
        if (window.lucide) lucide.createIcons();
    } catch (err) {
        console.error('Failed to load admin KYC list', err);
        listEl.innerHTML = '<p class="text-muted" style="text-align:center; padding: 2rem;">Could not load KYC applications. Make sure Firestore rules allow admin access.</p>';
    }
}

async function openAdminKycDetail(uid, summaryData) {
    const db = window.firebaseDb;
    const { doc, getDoc, collection, query, where, orderBy, getDocs, updateDoc } = window.dbFns;
    const contentEl = document.getElementById('adminKycDetailContent');

    contentEl.innerHTML = '<p class="text-muted" style="text-align:center; padding: 2rem;">Loading application...</p>';
    adminKycDetailModal.classList.add('active');

    try {
        // Fetch the full application doc from the subcollection.
        // Try the most recent one matching the kyc_app_id if available,
        // otherwise fall back to the latest application.
        let appData = null;
        const appId = summaryData.kyc_app_id;
        if (appId) {
            const snap = await getDoc(doc(db, 'users', uid, 'kyc_applications', appId));
            if (snap.exists()) appData = snap.data();
        }
        if (!appData) {
            // Fall back: get the latest application for this user
            const snap = await getDocs(query(collection(db, 'users', uid, 'kyc_applications'), where('status', '==', 'pending')));
            if (!snap.empty) appData = snap.docs[snap.docs.length - 1].data();
        }
        if (!appData) {
            contentEl.innerHTML = '<p class="text-muted" style="text-align:center; padding: 2rem;">No application data found.</p>';
            return;
        }

        const providerInfo = KYC_PROVIDERS[appData.provider] || { label: appData.provider || '—', color: '#666' };
        const idTypeLabel = KYC_ID_TYPES[appData.id_type] || appData.id_type || '—';

        // Helper to render an image (either a Storage download URL or a data URL)
        const docImage = (url, label, icon) => {
            if (!url) return `<div class="kyc-detail-doc"><div class="kyc-detail-doc-label"><i data-lucide="${icon}"></i> ${label}</div><div style="padding:1.5rem; text-align:center; color: var(--muted-foreground); font-size:0.8rem;">Not provided</div></div>`;
            // Check if it's a data URL or a Storage URL
            if (url.startsWith('data:')) {
                return `<div class="kyc-detail-doc"><div class="kyc-detail-doc-label"><i data-lucide="${icon}"></i> ${label}</div><img src="${escapeHtml(url)}" alt="${label}"></div>`;
            }
            return `<div class="kyc-detail-doc"><div class="kyc-detail-doc-label"><i data-lucide="${icon}"></i> ${label}</div><img src="${escapeHtml(url)}" alt="${label}"></div>`;
        };

        contentEl.innerHTML = `
            <div class="kyc-detail-section">
                <div class="kyc-detail-section-title"><i data-lucide="user"></i> Personal Information</div>
                <div class="kyc-detail-row"><span>Full Name</span><span>${escapeHtml(appData.full_name || '—')}</span></div>
                <div class="kyc-detail-row"><span>Date of Birth</span><span>${escapeHtml(appData.dob || '—')}</span></div>
                <div class="kyc-detail-row"><span>Region</span><span>${escapeHtml(appData.region || '—')}</span></div>
                <div class="kyc-detail-row"><span>Address</span><span>${escapeHtml(appData.address || '—')}</span></div>
                <div class="kyc-detail-row"><span>Email</span><span>${escapeHtml(appData.email || '—')}</span></div>
            </div>
            <div class="kyc-detail-section">
                <div class="kyc-detail-section-title"><i data-lucide="smartphone"></i> Mobile Money Account</div>
                <div class="kyc-detail-row"><span>Provider</span><span style="color: ${providerInfo.color};">${escapeHtml(providerInfo.label)}</span></div>
                <div class="kyc-detail-row"><span>Account Number</span><span>${escapeHtml(appData.momo_number || '—')}</span></div>
                <div class="kyc-detail-row"><span>Account Name</span><span>${escapeHtml(appData.momo_name || '—')}</span></div>
            </div>
            <div class="kyc-detail-section">
                <div class="kyc-detail-section-title"><i data-lucide="id-card"></i> Identity Document</div>
                <div class="kyc-detail-row"><span>ID Type</span><span>${escapeHtml(idTypeLabel)}</span></div>
                <div class="kyc-detail-row"><span>ID Number</span><span>${escapeHtml(appData.id_number || '—')}</span></div>
                <div class="kyc-detail-docs">
                    ${docImage(appData.id_front_url, 'Front of ID', 'image')}
                    ${docImage(appData.id_back_url, 'Back of ID', 'image')}
                </div>
            </div>
            <div id="kycRejectReasonContainer" class="kyc-reject-reason" hidden>
                <label style="font-size:0.83rem; font-weight:600; color:var(--foreground); display:block; margin-bottom:0.4rem;">Rejection reason (shown to user)</label>
                <textarea id="kycRejectReasonInput" placeholder="e.g., ID image is blurry, please re-upload a clearer photo."></textarea>
            </div>
            <div class="kyc-detail-actions">
                <button type="button" class="btn-approve" id="kycAdminApproveBtn"><i data-lucide="check"></i> Approve</button>
                <button type="button" class="btn-reject" id="kycAdminRejectBtn"><i data-lucide="x"></i> Reject</button>
            </div>
        `;
        if (window.lucide) lucide.createIcons();

        // Wire up approve/reject
        let rejectMode = false;
        const rejectBtn = document.getElementById('kycAdminRejectBtn');
        const approveBtn = document.getElementById('kycAdminApproveBtn');
        const reasonContainer = document.getElementById('kycRejectReasonContainer');

        rejectBtn.addEventListener('click', () => {
            if (!rejectMode) {
                rejectMode = true;
                reasonContainer.hidden = false;
                rejectBtn.innerHTML = '<i data-lucide="x"></i> Confirm Rejection';
                if (window.lucide) lucide.createIcons();
            } else {
                const reason = document.getElementById('kycRejectReasonInput').value.trim() || 'Your KYC application was rejected. Please review and resubmit.';
                handleAdminKycDecision(uid, appData.app_id, 'rejected', reason);
            }
        });

        approveBtn.addEventListener('click', () => {
            handleAdminKycDecision(uid, appData.app_id, 'approved', '');
        });
    } catch (err) {
        console.error('Failed to load KYC detail', err);
        contentEl.innerHTML = '<p class="text-muted" style="text-align:center; padding: 2rem;">Could not load application details.</p>';
    }
}

async function handleAdminKycDecision(uid, appId, decision, note) {
    const db = window.firebaseDb;
    const { doc, updateDoc, setDoc } = window.dbFns;
    const adminUid = window.firebaseAuth?.currentUser?.uid;
    const detailModal = document.getElementById('adminKycDetailModal');

    try {
        const now = new Date().toISOString();

        // Update the application doc in the subcollection
        if (appId) {
            try {
                await updateDoc(doc(db, 'users', uid, 'kyc_applications', appId), {
                    status: decision,
                    reviewed_at: now,
                    review_note: note,
                    reviewed_by: adminUid
                });
            } catch (err) {
                // updateDoc may fail if the doc doesn't exist; fall back to setDoc
                console.warn('updateDoc failed, trying setDoc merge', err);
                await setDoc(doc(db, 'users', uid, 'kyc_applications', appId), {
                    status: decision,
                    reviewed_at: now,
                    review_note: note,
                    reviewed_by: adminUid
                }, { merge: true });
            }
        }

        // Update the user's top-level doc
        const userUpdate = {
            kyc_status: decision,
            reviewed_at: now
        };
        if (decision === 'approved') {
            userUpdate.kyc_approved_at = now;
            userUpdate.kyc_rejection_reason = null;
        } else {
            userUpdate.kyc_rejection_reason = note;
            userUpdate.kyc_approved_at = null;
        }
        await setDoc(doc(db, 'users', uid), userUpdate, { merge: true });

        closeAdminKycDetailModal();
        triggerToast(decision === 'approved' ? 'KYC application approved. The user is now verified.' : 'KYC application rejected. The user has been notified.');

        // Refresh the admin list
        loadAdminKycList();

        // Update the admin nav badge count
        await updateAdminKycBadge();
    } catch (err) {
        console.error('Failed to update KYC decision', err);
        triggerToast('Failed to update KYC status. Check Firestore rules for admin access.');
    }
}

// Update the admin KYC badge count in the navbar
async function updateAdminKycBadge() {
    const badge = document.getElementById('adminKycBadge');
    if (!badge) return;

    const db = window.firebaseDb;
    const { collection, query, where, getDocs } = window.dbFns;

    try {
        const snap = await getDocs(query(collection(db, 'users'), where('kyc_status', '==', 'pending')));
        const count = snap.size;
        badge.textContent = count;
        badge.hidden = count === 0;
    } catch (err) {
        console.warn('Could not update KYC badge count', err);
        badge.hidden = true;
    }
}
window.updateAdminKycBadge = updateAdminKycBadge;

// --- Account deletion ---
const deleteAccountModal = document.getElementById('deleteAccountModal');
function closeDeleteAccountModal() {
    deleteAccountModal?.classList.remove('active');
    document.getElementById('deleteAccountConfirmInput').value = '';
    document.getElementById('deleteAccountPasswordInput').value = '';
}
document.getElementById('profileDeleteAccountBtn')?.addEventListener('click', () => {
    deleteAccountModal?.classList.add('active');
});
document.getElementById('closeDeleteAccountModal')?.addEventListener('click', closeDeleteAccountModal);
deleteAccountModal?.addEventListener('click', (e) => { if (e.target === deleteAccountModal) closeDeleteAccountModal(); });

document.getElementById('deleteAccountConfirmBtn')?.addEventListener('click', async () => {
    const user = window.firebaseAuth?.currentUser;
    if (!user) return;

    const typed = document.getElementById('deleteAccountConfirmInput').value.trim();
    if (typed !== 'DELETE') {
        triggerToast('Type DELETE exactly to confirm.');
        return;
    }

    const isPasswordAccount = (user.providerData || []).some((p) => p.providerId === 'password');

    // Account deletion requires a recent sign-in — re-authenticate first
    // rather than waiting for deleteUser() to reject with
    // auth/requires-recent-login, so the failure mode is a clear prompt
    // instead of a confusing error after everything else already ran.
    try {
        if (isPasswordAccount) {
            const password = document.getElementById('deleteAccountPasswordInput').value;
            if (!password) {
                triggerToast('Enter your password to confirm.');
                return;
            }
            const { EmailAuthProvider, reauthenticateWithCredential } = window.authFns;
            await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
        } else {
            const { GoogleAuthProvider, reauthenticateWithPopup } = window.authFns;
            await reauthenticateWithPopup(user, new GoogleAuthProvider());
        }
    } catch (err) {
        console.error('Re-authentication failed', err);
        triggerToast(mapFirebaseError(err));
        return;
    }

    // Delete owned Firestore data. Firestore rules allow a user to delete
    // their own crops/{id} (auth.uid == submitted_by) and their own
    // users/{uid} and public_keys/{uid} docs, so all of this works without
    // any rules changes. NOTE: crops/{id}/private/contact can only be
    // deleted by the admin per the existing rules, so that subdoc is left
    // behind (orphaned under a crop doc that no longer exists/shows up
    // anywhere) rather than attempted here — including it in this batch
    // would fail the whole batch for a non-admin user.
    try {
        const db = window.firebaseDb;
        const { collection, query, where, getDocs, doc, writeBatch } = window.dbFns;
        const cropsSnap = await getDocs(query(collection(db, 'crops'), where('submitted_by', '==', user.uid)));
        const batch = writeBatch(db);
        cropsSnap.docs.forEach((d) => batch.delete(doc(db, 'crops', d.id)));
        batch.delete(doc(db, 'users', user.uid));
        batch.delete(doc(db, 'public_keys', user.uid));
        await batch.commit();
    } catch (err) {
        console.warn('Cleanup before account deletion failed (continuing with account deletion anyway)', err);
    }

    // No separate avatar cleanup needed anymore — the profile photo is
    // stored as photo_url on the users/{uid} doc, which the batch delete
    // above already removes (nothing left over in Firebase Storage since
    // uploads no longer go there).

    teardownPresence(user.uid);

    try {
        const { deleteUser } = window.authFns;
        await deleteUser(user);
        closeDeleteAccountModal();
        triggerToast('Your account has been deleted.');
        // onAuthStateChanged fires with null and handles returning to the
        // landing page / resetting the UI, same as a normal sign-out.
    } catch (err) {
        console.error('Failed to delete account', err);
        triggerToast(mapFirebaseError(err));
    }
});


// ===================================================================
// ADMIN CONTENT MANAGEMENT
// ===================================================================
// Lets the admin (ADMIN_UID) edit, add, or delete almost every piece of
// site copy — hero, about, stats, services, how-it-works, testimonials,
// CTA, section headers, blog posts, and crop listings — from a UI instead
// of editing this file directly. Content lives in Firestore under the
// 'site_content' collection (one doc per section); blog posts and crops
// already had their own collections and are managed from here too.
//
// REQUIRED FIRESTORE RULES — add alongside your existing crops/KYC rules:
//   match /site_content/{docId} {
//     allow read: if true;
//     allow write: if request.auth != null && request.auth.uid == ADMIN_UID_VALUE;
//   }
//   match /posts/{postId} {
//     allow read: if true;
//     allow write: if request.auth != null && request.auth.uid == ADMIN_UID_VALUE;
//   }
// (Replace ADMIN_UID_VALUE with the same UID string as the ADMIN_UID
// constant at the top of this file — Firestore rules can't import JS.)
// crops/{cropId} write-by-admin rules should already exist alongside your
// approve/reject logic; if not, mirror the same pattern there.
// ===================================================================

const DEFAULT_SITE_CONTENT = {
    hero: {
        title: "Connecting Sierra Leone's Farmers to the World",
        subtitle: "Sign in to access real-time crop prices, contact local farmers, and view agricultural data.",
        subtitle_signed_in: "You're signed in — browse what AgriMarket SL offers below, or use the Marketplace button above to return to your dashboard."
    },
    about: {
        label: "About AgriMarket SL",
        title: "Empowering Farmers with Real-Time Market Access",
        body1: "AgriMarket SL bridges the gap between Sierra Leone's hardworking farmers and buyers across the country. We provide live crop pricing, direct farmer contacts, and regional market data; all in one platform built for the agricultural community.",
        body2: "Founded with a mission to eliminate middlemen and bring transparency, we ensure that every farmer gets a fair deal and every buyer finds quality produce at the right price.",
        badge_title: "Since 2026",
        badge_subtitle: "Serving Sierra Leone"
    },
    stats: {
        items: [
            { id: 's1', value: '10', label: 'Farmers Listed' },
            { id: 's2', value: '50', label: 'Crop Varieties' },
            { id: 's3', value: '3', label: 'Regions Covered' },
            { id: 's4', value: '20', label: 'Monthly Listings' }
        ]
    },
    services: {
        label: "Our Services",
        title: "Everything You Need for a Better Market",
        subtitle: "Tools and services designed specifically for Sierra Leone's agricultural ecosystem.",
        items: [
            { id: 'sv1', icon: 'rice', color: 'green', title: 'Live Crop Pricing', desc: "Access real-time market prices for rice, cocoa, cassava, and more across all major regions in Sierra Leone.", tags: ['Real-time', 'Regional', 'Verified', 'Secure Purchase'] },
            { id: 'sv2', icon: 'link', color: 'blue', title: 'Direct Farmer Contact', desc: "Connect directly with farmers and buyers - no middlemen, no hidden fees. Build trusted business relationships.", tags: ['No middlemen', 'Verified contacts', 'Secure purchase'] },
            { id: 'sv3', icon: 'map', color: 'earth', title: 'Regional Market Data', desc: "Explore market trends, supply levels, and pricing history across Bo, Kenema, Makeni, Western Area and other parts of Sierra Leone.", tags: ['4 regions', 'All districts', 'Trends', 'Analytics'] },
            { id: 'sv4', icon: 'shield', color: 'green', title: 'Secure Transactions', desc: "Verified listings and trusted seller badges ensure that every transaction is safe and transparent.", tags: ['Verified', 'Trusted', 'Secure Purchase'] },
            { id: 'sv5', icon: 'bell', color: 'blue', title: 'Price Alerts', desc: "Set price thresholds and get notified when your target crops hit the right price in your preferred region.", tags: ['Notifications', 'Custom'] },
            { id: 'sv6', icon: 'trend', color: 'earth', title: 'Market Insights', desc: "Weekly reports on crop performance, seasonal trends, and demand forecasts to help you plan ahead.", tags: ['Reports', 'Weekly', 'Forecasts'] }
        ]
    },
    how_it_works: {
        label: "How It Works",
        title: "Simple Steps to Get Started",
        subtitle: "From sign-up to your first market deal — it only takes a few minutes.",
        steps: [
            { id: 'st1', title: 'Create Account', desc: "Sign up with your email and password. It's free and takes less than a minute." },
            { id: 'st2', title: 'Browse Listings', desc: "Search crops by name, filter by region, and compare real-time prices at a glance." },
            { id: 'st3', title: 'Connect Directly', desc: "Get verified phone numbers and contact details of farmers and traders instantly." },
            { id: 'st4', title: 'Trade Smart', desc: "Close deals with confidence using transparent pricing and trusted seller information." },
            { id: 'st5', title: 'Chat Smart', desc: "Close deals with confidence using transparent pricing and trusted seller information and our secure end-to-end chat platform with verified users." }
        ]
    },
    testimonials: {
        label: "Testimonials",
        title: "Trusted by Farmers & Buyers",
        subtitle: "Hear from the people who use AgriMarket SL every day.",
        items: [
            { id: 't1', name: 'Mohamed Sesay', role: 'Rice Farmer · Makeni', quote: "AgriMarket SL helped me find buyers for my rice harvest without any middlemen. I got a much better price this season!", avatar_url: 'images/mohamed_sesay_rice_farmer.jpeg', stars: 5 },
            { id: 't2', name: 'Catherine Caulker', role: 'Market Trader · Freetown', quote: "I can check live prices before heading to the market. It saves me time and ensures I never overpay for produce.", avatar_url: 'images/fatmata_kamara_market_trader.jpeg', stars: 5 },
            { id: 't3', name: 'Abdul Rahman', role: 'Export Buyer · Kenema/Bo/Makeni/Freetown', quote: "The regional filter is a game changer. I track cocoa prices across Kenema and Bo and know exactly where to buy.", avatar_url: 'images/abdul_rahman_export_buyer.jpeg', stars: 4.5 }
        ]
    },
    cta: {
        title: "Ready to Access Live Market Prices?",
        subtitle: "Join hundreds of farmers and buyers already trading smarter on AgriMarket SL.",
        button_text: "Get Started Free"
    },
    crops_header: {
        label: "Popular Crops",
        title: "What's on the Market",
        subtitle: "Explore the most traded crops across Sierra Leone's agricultural regions."
    },
    blog_header: {
        label: "From the Blog",
        title: "Market Insights & Farming Tips",
        subtitle: "News, pricing trends, and practical advice for Sierra Leone's farmers and buyers."
    },
    newsletter: {
        title: "Stay Ahead of the Market",
        subtitle: "Get weekly crop price updates and farming tips straight to your inbox."
    },
    footer: {
        tagline: "Empowering Sierra Leone's farmers with real-time market access, transparent pricing, and direct buyer connections.",
        email: "support@agrimarketsl.com",
        phone: "+23276786944",
        address: "Kenema, Eastern Region, Sierra Leone",
        hours: "Mon – Sat: 8AM – 6PM GMT",
        copyright_name: "AgriMarket SL"
    }
};

// Only these six keys can ever be stored for a service card's icon — the
// admin picks from this fixed set rather than entering raw SVG/HTML, so
// there's no way saved content can inject markup onto the public page.
const SERVICE_ICON_SVGS = {
    rice: '<path d="M12 21C12 21 11 11 13 4"/><path d="M12 17L8 15"/><path d="M12 17L16 15"/><path d="M12 14L8 12"/><path d="M12 14L16 12"/><path d="M12 11L8 9"/><path d="M12 11L16 9"/><path d="M12.5 8L9.5 6"/><path d="M12.5 8L15.5 6"/>',
    link: '<circle cx="6" cy="12" r="3"/><circle cx="18" cy="12" r="3"/><path d="M9 12H15"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    map: '<path d="M4 8L9 5L15 6L20 9L19 16L13 19L6 18L4 8Z"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="8" cy="15" r="1" fill="currentColor" stroke="none" opacity="0.5"/><circle cx="16" cy="9" r="1" fill="currentColor" stroke="none" opacity="0.5"/>',
    shield: '<path d="M12 3L19 6V12C19 17 15.5 20 12 21C8.5 20 5 17 5 12V6L12 3Z"/><path d="M8.5 12L11 14.5L15.5 9.5"/>',
    bell: '<path d="M12 5C9 5 7.5 7 7.5 10C7.5 14 6 15.5 6 15.5H18C18 15.5 16.5 14 16.5 10C16.5 7 15 5 12 5Z"/><path d="M10 17.5C10 18.6 10.9 19.5 12 19.5C13.1 19.5 14 18.6 14 17.5"/><circle cx="17.5" cy="5.5" r="2" fill="currentColor" stroke="none"/>',
    trend: '<path d="M4 20H20" opacity="0.35"/><path d="M4 16L9 12L13 15L19 7"/><path d="M19 7C20 6 20.8 6 21.3 4.3"/>'
};
const SERVICE_ICON_LABELS = { rice: 'Rice panicle (crop/pricing)', link: 'Direct link (contact)', map: 'Region map (data)', shield: 'Shield check (security)', bell: 'Bell (alerts)', trend: 'Growth trend (insights)' };

function serviceIconSvg(key) {
    const inner = SERVICE_ICON_SVGS[key] || SERVICE_ICON_SVGS.rice;
    return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

function starsHtml(stars) {
    const n = Number(stars) || 0;
    const full = Math.floor(n);
    const half = (n - full) >= 0.5;
    let html = '';
    for (let i = 0; i < full; i++) html += '<i data-lucide="star"></i>';
    if (half) html += '<i data-lucide="star-half"></i>';
    return html;
}

// Populated by loadSiteContent() from Firestore; falls back to
// DEFAULT_SITE_CONTENT for any doc/field that hasn't been edited yet, so
// the site never shows blank content just because the admin hasn't
// touched a given section.
let siteContentCache = {};

function getSiteContent(key) {
    return { ...DEFAULT_SITE_CONTENT[key], ...(siteContentCache[key] || {}) };
}

async function loadSiteContent() {
    const db = window.firebaseDb;
    const { collection, getDocs } = window.dbFns;
    try {
        const snap = await getDocs(collection(db, 'site_content'));
        const fetched = {};
        snap.docs.forEach((d) => { fetched[d.id] = d.data(); });
        siteContentCache = fetched;
    } catch (err) {
        console.error('Failed to load site content, using defaults', err);
        siteContentCache = {};
    }
    renderAllSiteContent();
}
window.loadSiteContent = loadSiteContent;

function renderAllSiteContent() {
    renderHeroContent();
    renderAboutContent();
    renderServicesContent();
    renderHowItWorksContent();
    renderTestimonialsContent();
    renderCtaContent();
    renderCropsHeaderContent();
    renderBlogHeaderContent();
    renderNewsletterContent();
    renderFooterContent();
    if (window.lucide) lucide.createIcons();
    window.initStatsCounters?.();
}

function renderHeroContent() {
    const d = getSiteContent('hero');
    window.HERO_CONTENT = d;
    const titleEl = document.getElementById('heroTitle');
    if (titleEl) titleEl.textContent = d.title;
    window.syncHeroTextForAuthState?.();
}

function renderAboutContent() {
    const d = getSiteContent('about');
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('aboutLabel', d.label);
    set('aboutTitle', d.title);
    set('aboutBody1', d.body1);
    set('aboutBody2', d.body2);
    set('aboutBadgeTitle', d.badge_title);
    set('aboutBadgeSubtitle', d.badge_subtitle);

    const stats = getSiteContent('stats').items || [];
    const statsRow = document.getElementById('statsRow');
    if (statsRow && stats.length) {
        statsRow.innerHTML = stats.map((s) => `
            <div class="stat-card">
                <div class="stat-number" data-count="${parseInt(s.value) || 0}">0</div>
                <div class="stat-label">${escapeHtml(s.label)}</div>
            </div>
        `).join('');
    }
}

function renderServicesContent() {
    const d = getSiteContent('services');
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('servicesLabel', d.label);
    set('servicesTitle', d.title);
    set('servicesSubtitle', d.subtitle);

    const grid = document.getElementById('servicesGrid');
    if (grid && Array.isArray(d.items) && d.items.length) {
        grid.innerHTML = d.items.map((item) => `
            <div class="service-card">
                <div class="service-icon service-icon-${escapeHtml(item.color || 'green')}">${serviceIconSvg(item.icon)}</div>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.desc)}</p>
                <div class="service-tags">
                    ${(item.tags || []).map((t) => `<span class="service-tag">${escapeHtml(t)}</span>`).join('')}
                </div>
            </div>
        `).join('');
    }
}

function renderHowItWorksContent() {
    const d = getSiteContent('how_it_works');
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('howItWorksLabel', d.label);
    set('howItWorksTitle', d.title);
    set('howItWorksSubtitle', d.subtitle);

    const grid = document.getElementById('stepsGrid');
    if (grid && Array.isArray(d.steps) && d.steps.length) {
        grid.innerHTML = d.steps.map((step, i) => `
            <div class="step-card">
                <div class="step-number">${i + 1}</div>
                <h3>${escapeHtml(step.title)}</h3>
                <p>${escapeHtml(step.desc)}</p>
            </div>
        `).join('');
    }
}

function renderTestimonialsContent() {
    const d = getSiteContent('testimonials');
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('testimonialsLabel', d.label);
    set('testimonialsTitle', d.title);
    set('testimonialsSubtitle', d.subtitle);

    const grid = document.getElementById('testimonialsGrid');
    if (grid && Array.isArray(d.items) && d.items.length) {
        grid.innerHTML = d.items.map((t) => `
            <div class="testimonial-card">
                <div class="testimonial-stars">${starsHtml(t.stars)}</div>
                <blockquote>"${escapeHtml(t.quote)}"</blockquote>
                <div class="testimonial-author">
                    <img src="${escapeHtml(t.avatar_url || FALLBACK_IMAGE)}" alt="${escapeHtml(t.name)}" class="testimonial-avatar" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}'">
                    <div>
                        <div class="testimonial-name">${escapeHtml(t.name)}</div>
                        <div class="testimonial-role">${escapeHtml(t.role)}</div>
                    </div>
                </div>
            </div>
        `).join('');
    }
}

function renderCtaContent() {
    const d = getSiteContent('cta');
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('ctaTitle', d.title);
    set('ctaSubtitle', d.subtitle);
    set('ctaButtonText', d.button_text);
}

function renderCropsHeaderContent() {
    const d = getSiteContent('crops_header');
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('cropsLabel', d.label);
    set('cropsTitle', d.title);
    set('cropsSubtitle', d.subtitle);
}

function renderBlogHeaderContent() {
    const d = getSiteContent('blog_header');
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('blogLabel', d.label);
    set('blogTitle', d.title);
    set('blogSubtitle', d.subtitle);
}

function renderNewsletterContent() {
    const d = getSiteContent('newsletter');
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('newsletterTitle', d.title);
    set('newsletterSubtitle', d.subtitle);
}

function renderFooterContent() {
    const d = getSiteContent('footer');
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('footerTagline', d.tagline);
    set('footerAddress', d.address);
    set('footerHours', d.hours);
    set('footerCopyrightName', d.copyright_name);
    const emailEl = document.getElementById('footerEmail');
    if (emailEl) { emailEl.textContent = d.email; emailEl.href = `mailto:${d.email}`; }
    const phoneEl = document.getElementById('footerPhone');
    if (phoneEl) { phoneEl.textContent = d.phone; phoneEl.href = `tel:${(d.phone || '').replace(/[^+\d]/g, '')}`; }
}

// ---- Generic form helpers used by every admin editor below ----
function adminFormFieldsHtml(schema, values) {
    return schema.map((f) => {
        const val = values[f.key] ?? '';
        if (f.type === 'textarea') {
            return `<div class="form-group"><label>${escapeHtml(f.label)}</label><textarea data-field="${f.key}" rows="3">${escapeHtml(val)}</textarea></div>`;
        }
        if (f.type === 'select') {
            const opts = f.options.map((o) => `<option value="${escapeHtml(o.value)}" ${values[f.key] === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
            return `<div class="form-group"><label>${escapeHtml(f.label)}</label><select data-field="${f.key}">${opts}</select></div>`;
        }
        return `<div class="form-group"><label>${escapeHtml(f.label)}</label><input type="${f.type === 'number' ? 'number' : 'text'}" data-field="${f.key}" value="${escapeHtml(val)}"></div>`;
    }).join('');
}
function adminReadFormFields(schema, container) {
    const out = {};
    schema.forEach((f) => {
        const el = container.querySelector(`[data-field="${f.key}"]`);
        if (!el) return;
        if (f.type === 'number') out[f.key] = Number(el.value || 0);
        else if (f.key === 'tags') out[f.key] = el.value.split(',').map((t) => t.trim()).filter(Boolean);
        else out[f.key] = el.value.trim();
    });
    return out;
}

const SERVICE_ITEM_SCHEMA = [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'desc', label: 'Description', type: 'textarea' },
    { key: 'icon', label: 'Icon', type: 'select', options: Object.keys(SERVICE_ICON_LABELS).map((k) => ({ value: k, label: SERVICE_ICON_LABELS[k] })) },
    { key: 'color', label: 'Color', type: 'select', options: [{ value: 'green', label: 'Green' }, { value: 'blue', label: 'Blue' }, { value: 'earth', label: 'Earth' }] },
    { key: 'tags', label: 'Tags (comma separated)', type: 'text' }
];
const STAT_ITEM_SCHEMA = [
    { key: 'value', label: 'Number (e.g. 10)', type: 'text' },
    { key: 'label', label: 'Label', type: 'text' }
];
const STEP_ITEM_SCHEMA = [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'desc', label: 'Description', type: 'textarea' }
];
const TESTIMONIAL_ITEM_SCHEMA = [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'role', label: 'Role / Location', type: 'text' },
    { key: 'quote', label: 'Quote', type: 'textarea' },
    { key: 'avatar_url', label: 'Photo URL', type: 'text' },
    { key: 'stars', label: 'Stars (0-5)', type: 'number' }
];
const SIMPLE_TEXT_SECTIONS = {
    hero: { label: 'Hero banner', fields: [{ key: 'title', label: 'Headline', type: 'text' }, { key: 'subtitle', label: 'Subtext (signed out)', type: 'textarea' }, { key: 'subtitle_signed_in', label: 'Subtext (signed in)', type: 'textarea' }], render: renderHeroContent },
    about: { label: 'About section', fields: [{ key: 'label', label: 'Eyebrow label', type: 'text' }, { key: 'title', label: 'Heading', type: 'text' }, { key: 'body1', label: 'Body paragraph 1', type: 'textarea' }, { key: 'body2', label: 'Body paragraph 2', type: 'textarea' }, { key: 'badge_title', label: 'Photo badge title', type: 'text' }, { key: 'badge_subtitle', label: 'Photo badge subtitle', type: 'text' }], render: renderAboutContent },
    cta: { label: 'CTA banner', fields: [{ key: 'title', label: 'Heading', type: 'text' }, { key: 'subtitle', label: 'Subtext', type: 'textarea' }, { key: 'button_text', label: 'Button text', type: 'text' }], render: renderCtaContent },
    crops_header: { label: 'Crops section header', fields: [{ key: 'label', label: 'Eyebrow label', type: 'text' }, { key: 'title', label: 'Heading', type: 'text' }, { key: 'subtitle', label: 'Subtext', type: 'textarea' }], render: renderCropsHeaderContent },
    blog_header: { label: 'Blog section header', fields: [{ key: 'label', label: 'Eyebrow label', type: 'text' }, { key: 'title', label: 'Heading', type: 'text' }, { key: 'subtitle', label: 'Subtext', type: 'textarea' }], render: renderBlogHeaderContent },
    newsletter: { label: 'Newsletter box', fields: [{ key: 'title', label: 'Heading', type: 'text' }, { key: 'subtitle', label: 'Subtext', type: 'textarea' }], render: renderNewsletterContent },
    footer: { label: 'Footer', fields: [{ key: 'tagline', label: 'Brand tagline', type: 'textarea' }, { key: 'email', label: 'Contact email', type: 'text' }, { key: 'phone', label: 'Contact phone', type: 'text' }, { key: 'address', label: 'Address', type: 'text' }, { key: 'hours', label: 'Business hours', type: 'text' }, { key: 'copyright_name', label: 'Copyright name', type: 'text' }], render: renderFooterContent }
};
const LIST_SECTIONS = {
    stats: { label: 'Stats row', arrayKey: 'items', itemLabel: 'stat', schema: STAT_ITEM_SCHEMA, render: renderAboutContent, summary: (i) => `${i.value} — ${i.label}` },
    services: { label: 'Services grid', arrayKey: 'items', itemLabel: 'service', schema: SERVICE_ITEM_SCHEMA, render: renderServicesContent, summary: (i) => i.title },
    how_it_works: { label: 'How it works steps', arrayKey: 'steps', itemLabel: 'step', schema: STEP_ITEM_SCHEMA, render: renderHowItWorksContent, summary: (i) => i.title },
    testimonials: { label: 'Testimonials', arrayKey: 'items', itemLabel: 'testimonial', schema: TESTIMONIAL_ITEM_SCHEMA, render: renderTestimonialsContent, summary: (i) => `${i.name} — ${(i.quote || '').slice(0, 40)}…` }
};

async function saveSiteContentDoc(key, data) {
    const db = window.firebaseDb;
    const { doc, setDoc } = window.dbFns;
    await setDoc(doc(db, 'site_content', key), data, { merge: true });
    siteContentCache[key] = { ...siteContentCache[key], ...data };
}

function adminGenId() { return 'i' + Math.random().toString(36).slice(2, 10); }

// ---- Admin dashboard shell ----
const ADMIN_SECTIONS = [
    { group: 'Site content', key: 'hero', label: 'Hero banner' },
    { group: 'Site content', key: 'about', label: 'About & Stats' },
    { group: 'Site content', key: 'services', label: 'Services grid' },
    { group: 'Site content', key: 'how_it_works', label: 'How it works' },
    { group: 'Site content', key: 'testimonials', label: 'Testimonials' },
    { group: 'Site content', key: 'cta', label: 'CTA banner' },
    { group: 'Site content', key: 'crops_header', label: 'Crops header' },
    { group: 'Site content', key: 'blog_header', label: 'Blog header' },
    { group: 'Site content', key: 'newsletter', label: 'Newsletter box' },
    { group: 'Site content', key: 'footer', label: 'Footer' },
    { group: 'Marketplace', key: 'blog_posts', label: 'Blog posts' },
    { group: 'Marketplace', key: 'crops_manage', label: 'Manage crops' },
    { group: 'Marketplace', key: 'kyc', label: 'KYC requests' },
    { group: 'Insights', key: 'analytics', label: 'Analytics' }
];

function showAdminDashboardView() {
    document.getElementById('landingPage').style.display = 'none';
    document.getElementById('landingSections').style.display = 'none';
    document.getElementById('landingNav').style.display = 'none';
    document.getElementById('dashboardApp').style.display = 'none';
    document.getElementById('profileView')?.style && (document.getElementById('profileView').style.display = 'none');
    const view = document.getElementById('adminDashboardApp');
    view.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    renderAdminSidebar();
    openAdminSection('hero');
}
window.showAdminDashboardView = showAdminDashboardView;

function hideAdminDashboardView() {
    document.getElementById('adminDashboardApp').style.display = 'none';
    window.showDashboardView?.();
}
window.hideAdminDashboardView = hideAdminDashboardView;

function renderAdminSidebar() {
    const nav = document.getElementById('adminSidebarNav');
    if (!nav) return;
    let currentGroup = '';
    let html = '';
    ADMIN_SECTIONS.forEach((s) => {
        if (s.group !== currentGroup) {
            currentGroup = s.group;
            html += `<div class="admin-sidebar-group">${escapeHtml(currentGroup)}</div>`;
        }
        html += `<button type="button" class="admin-sidebar-item" data-section="${s.key}">${escapeHtml(s.label)}</button>`;
    });
    nav.innerHTML = html;
    nav.querySelectorAll('.admin-sidebar-item').forEach((btn) => {
        btn.addEventListener('click', () => openAdminSection(btn.getAttribute('data-section')));
    });
}

function setActiveAdminSidebarItem(key) {
    document.querySelectorAll('.admin-sidebar-item').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-section') === key);
    });
}

function openAdminSection(key) {
    setActiveAdminSidebarItem(key);
    const panel = document.getElementById('adminPanelContent');
    if (!panel) return;

    if (SIMPLE_TEXT_SECTIONS[key]) return renderSimpleTextEditor(key, panel);
    if (LIST_SECTIONS[key]) return renderListEditor(key, panel);
    if (key === 'blog_posts') return renderBlogPostsEditor(panel);
    if (key === 'crops_manage') return renderCropsManageEditor(panel);
    if (key === 'analytics') return renderAdminAnalytics(panel);
    if (key === 'kyc') {
        panel.innerHTML = `
            <h3>KYC verification requests</h3>
            <p class="text-muted" style="margin-bottom:1rem;">Review farmer/buyer identity verification submissions in the existing KYC panel.</p>
            <button type="button" class="btn-blue" id="adminOpenKycBtn">Open KYC review</button>
        `;
        document.getElementById('adminOpenKycBtn').addEventListener('click', () => openAdminKycModal());
    }
}

function renderSimpleTextEditor(key, panel) {
    const section = SIMPLE_TEXT_SECTIONS[key];
    const values = getSiteContent(key);
    panel.innerHTML = `
        <h3>${escapeHtml(section.label)}</h3>
        <form id="adminSimpleForm">
            ${adminFormFieldsHtml(section.fields, values)}
            <button type="submit" class="btn-blue">Save changes</button>
        </form>
    `;
    document.getElementById('adminSimpleForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = adminReadFormFields(section.fields, e.target);
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
            await saveSiteContentDoc(key, data);
            section.render();
            if (window.lucide) lucide.createIcons();
            triggerToast('Saved. The live page has been updated.');
        } catch (err) {
            console.error('Failed to save site content', err);
            triggerToast(mapFirebaseError(err));
        } finally {
            btn.disabled = false;
            btn.textContent = 'Save changes';
        }
    });
}

function renderListEditor(key, panel) {
    const section = LIST_SECTIONS[key];
    const data = getSiteContent(key);
    const items = data[section.arrayKey] || [];

    panel.innerHTML = `
        <div class="admin-section-header">
            <h3>${escapeHtml(section.label)}</h3>
            <button type="button" class="btn-blue" id="adminAddItemBtn"><i data-lucide="plus"></i> Add ${escapeHtml(section.itemLabel)}</button>
        </div>
        <div id="adminListItems" class="admin-item-list"></div>
    `;
    if (window.lucide) lucide.createIcons();

    const listEl = document.getElementById('adminListItems');
    function renderRows() {
        if (!items.length) {
            listEl.innerHTML = `<p class="text-muted">No ${escapeHtml(section.itemLabel)}s yet.</p>`;
            return;
        }
        listEl.innerHTML = items.map((item, i) => `
            <div class="admin-item-row">
                <span>${escapeHtml(section.summary(item))}</span>
                <div class="admin-item-row-actions">
                    <button type="button" class="btn-outline" data-edit="${i}">Edit</button>
                    <button type="button" class="btn-delete" data-delete="${i}">Delete</button>
                </div>
            </div>
        `).join('');
        listEl.querySelectorAll('[data-edit]').forEach((btn) => {
            btn.addEventListener('click', () => openAdminItemModal(section, items, Number(btn.getAttribute('data-edit')), key));
        });
        listEl.querySelectorAll('[data-delete]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!window.confirm(`Delete this ${section.itemLabel}?`)) return;
                items.splice(Number(btn.getAttribute('data-delete')), 1);
                await saveSiteContentDoc(key, { [section.arrayKey]: items });
                section.render();
                if (window.lucide) lucide.createIcons();
                triggerToast('Deleted.');
                renderRows();
            });
        });
    }
    renderRows();

    document.getElementById('adminAddItemBtn').addEventListener('click', () => {
        openAdminItemModal(section, items, -1, key);
    });
}

// Shared modal for adding/editing a single item within any list section
// (stats, services, how-it-works steps, testimonials).
function openAdminItemModal(section, items, index, key) {
    const isNew = index === -1;
    const values = isNew ? {} : items[index];
    const modal = document.getElementById('adminItemModal');
    const body = document.getElementById('adminItemModalBody');
    body.innerHTML = `
        <h3>${isNew ? 'Add' : 'Edit'} ${escapeHtml(section.itemLabel)}</h3>
        <form id="adminItemForm">
            ${adminFormFieldsHtml(section.schema, values.tags ? { ...values, tags: values.tags.join(', ') } : values)}
            <div style="display:flex; gap:0.75rem; margin-top:0.5rem;">
                <button type="submit" class="btn-blue">Save</button>
                <button type="button" class="btn-outline" id="adminItemCancelBtn">Cancel</button>
            </div>
        </form>
    `;
    modal.classList.add('active');
    document.getElementById('adminItemCancelBtn').addEventListener('click', () => modal.classList.remove('active'));
    document.getElementById('adminItemForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const newValues = adminReadFormFields(section.schema, e.target);
        if (isNew) {
            items.push({ id: adminGenId(), ...newValues });
        } else {
            items[index] = { ...values, ...newValues };
        }
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
            await saveSiteContentDoc(key, { [section.arrayKey]: items });
            section.render();
            if (window.lucide) lucide.createIcons();
            triggerToast('Saved. The live page has been updated.');
            modal.classList.remove('active');
            openAdminSection(key);
        } catch (err) {
            console.error('Failed to save item', err);
            triggerToast(mapFirebaseError(err));
            btn.disabled = false;
            btn.textContent = 'Save';
        }
    });
}

// ---- Blog posts manager (separate 'posts' collection, one doc per post) ----
const BLOG_POST_SCHEMA = [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'author', label: 'Author', type: 'text' },
    { key: 'category', label: 'Category tag', type: 'text' },
    { key: 'image_url', label: 'Image URL', type: 'text' },
    { key: 'excerpt', label: 'Excerpt (shown on card)', type: 'textarea' },
    { key: 'content', label: 'Full post content', type: 'textarea' }
];

async function renderBlogPostsEditor(panel) {
    panel.innerHTML = `
        <div class="admin-section-header">
            <h3>Blog posts</h3>
            <button type="button" class="btn-blue" id="adminAddPostBtn"><i data-lucide="plus"></i> New post</button>
        </div>
        <div id="adminPostsList" class="admin-item-list"><p class="text-muted">Loading…</p></div>
    `;
    if (window.lucide) lucide.createIcons();
    document.getElementById('adminAddPostBtn').addEventListener('click', () => openAdminPostModal(null));

    const db = window.firebaseDb;
    const { collection, getDocs, query, orderBy } = window.dbFns;
    const listEl = document.getElementById('adminPostsList');
    try {
        const snap = await getDocs(query(collection(db, 'posts'), orderBy('published_at', 'desc')));
        const posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (!posts.length) {
            listEl.innerHTML = '<p class="text-muted">No blog posts yet.</p>';
            return;
        }
        listEl.innerHTML = posts.map((p) => `
            <div class="admin-item-row">
                <span>${escapeHtml(p.title || 'Untitled post')}</span>
                <div class="admin-item-row-actions">
                    <button type="button" class="btn-outline" data-edit-post="${p.id}">Edit</button>
                    <button type="button" class="btn-delete" data-delete-post="${p.id}">Delete</button>
                </div>
            </div>
        `).join('');
        listEl.querySelectorAll('[data-edit-post]').forEach((btn) => {
            const post = posts.find((p) => p.id === btn.getAttribute('data-edit-post'));
            btn.addEventListener('click', () => openAdminPostModal(post));
        });
        listEl.querySelectorAll('[data-delete-post]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!window.confirm('Delete this blog post permanently?')) return;
                try {
                    const { doc, deleteDoc } = window.dbFns;
                    await deleteDoc(doc(db, 'posts', btn.getAttribute('data-delete-post')));
                    triggerToast('Post deleted.');
                    renderBlogPostsEditor(panel);
                    loadBlogPosts();
                } catch (err) {
                    console.error('Failed to delete post', err);
                    triggerToast(mapFirebaseError(err));
                }
            });
        });
    } catch (err) {
        console.error('Failed to load posts for admin', err);
        listEl.innerHTML = '<p class="text-muted">Could not load blog posts.</p>';
    }
}

function openAdminPostModal(post) {
    const isNew = !post;
    const modal = document.getElementById('adminItemModal');
    const body = document.getElementById('adminItemModalBody');
    body.innerHTML = `
        <h3>${isNew ? 'New' : 'Edit'} blog post</h3>
        <form id="adminPostForm">
            ${adminFormFieldsHtml(BLOG_POST_SCHEMA, post || {})}
            <div style="display:flex; gap:0.75rem; margin-top:0.5rem;">
                <button type="submit" class="btn-blue">${isNew ? 'Publish' : 'Save'}</button>
                <button type="button" class="btn-outline" id="adminPostCancelBtn">Cancel</button>
            </div>
        </form>
    `;
    modal.classList.add('active');
    document.getElementById('adminPostCancelBtn').addEventListener('click', () => modal.classList.remove('active'));
    document.getElementById('adminPostForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = adminReadFormFields(BLOG_POST_SCHEMA, e.target);
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
            const db = window.firebaseDb;
            const { doc, setDoc, collection } = window.dbFns;
            const ref = isNew ? doc(collection(db, 'posts')) : doc(db, 'posts', post.id);
            await setDoc(ref, {
                ...data,
                published_at: isNew ? new Date().toISOString() : (post.published_at || new Date().toISOString())
            }, { merge: true });
            triggerToast(isNew ? 'Post published.' : 'Post updated.');
            modal.classList.remove('active');
            openAdminSection('blog_posts');
            loadBlogPosts();
        } catch (err) {
            console.error('Failed to save post', err);
            triggerToast(mapFirebaseError(err));
            btn.disabled = false;
            btn.textContent = isNew ? 'Publish' : 'Save';
        }
    });
}

// ---- Crops manager (edit/delete ANY listing, any status — approve/reject
// of pending ones already exists in the Pending Approvals section) ----
const CROP_EDIT_SCHEMA = [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'location', label: 'Region', type: 'text' },
    { key: 'price', label: 'Price (SLLE)', type: 'number' },
    { key: 'image_url', label: 'Image URL', type: 'text' },
    { key: 'status', label: 'Status', type: 'select', options: [{ value: 'approved', label: 'Approved (live)' }, { value: 'pending', label: 'Pending' }, { value: 'rejected', label: 'Rejected' }] }
];

async function renderCropsManageEditor(panel) {
    panel.innerHTML = `
        <div class="admin-section-header">
            <h3>Manage crops</h3>
            <span class="text-muted">Edit or delete any listing, regardless of status.</span>
        </div>
        <div id="adminCropsList" class="admin-item-list"><p class="text-muted">Loading…</p></div>
    `;
    const db = window.firebaseDb;
    const { collection, getDocs, query, orderBy } = window.dbFns;
    const listEl = document.getElementById('adminCropsList');
    try {
        const snap = await getDocs(query(collection(db, 'crops'), orderBy('created_at', 'desc')));
        const crops = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (!crops.length) {
            listEl.innerHTML = '<p class="text-muted">No listings yet.</p>';
            return;
        }
        listEl.innerHTML = crops.map((c) => `
            <div class="admin-item-row">
                <span>${escapeHtml(c.name || 'Unnamed')} <span class="text-muted">(${escapeHtml(c.status || 'unknown')})</span></span>
                <div class="admin-item-row-actions">
                    <button type="button" class="btn-outline" data-edit-crop="${c.id}">Edit</button>
                    <button type="button" class="btn-delete" data-delete-crop="${c.id}">Delete</button>
                </div>
            </div>
        `).join('');
        listEl.querySelectorAll('[data-edit-crop]').forEach((btn) => {
            const crop = crops.find((c) => c.id === btn.getAttribute('data-edit-crop'));
            btn.addEventListener('click', () => openAdminCropModal(crop));
        });
        listEl.querySelectorAll('[data-delete-crop]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                await handleDeleteListing(btn.getAttribute('data-delete-crop'), { refreshLive: true });
                renderCropsManageEditor(panel);
            });
        });
    } catch (err) {
        console.error('Failed to load crops for admin', err);
        listEl.innerHTML = '<p class="text-muted">Could not load listings.</p>';
    }
}

function openAdminCropModal(crop) {
    const modal = document.getElementById('adminItemModal');
    const body = document.getElementById('adminItemModalBody');
    body.innerHTML = `
        <h3>Edit listing</h3>
        <form id="adminCropForm">
            ${adminFormFieldsHtml(CROP_EDIT_SCHEMA, crop)}
            <div style="display:flex; gap:0.75rem; margin-top:0.5rem;">
                <button type="submit" class="btn-blue">Save</button>
                <button type="button" class="btn-outline" id="adminCropCancelBtn">Cancel</button>
            </div>
        </form>
    `;
    modal.classList.add('active');
    document.getElementById('adminCropCancelBtn').addEventListener('click', () => modal.classList.remove('active'));
    document.getElementById('adminCropForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = adminReadFormFields(CROP_EDIT_SCHEMA, e.target);
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
            const db = window.firebaseDb;
            const { doc, setDoc } = window.dbFns;
            await setDoc(doc(db, 'crops', crop.id), { ...data, name_lower: data.name.toLowerCase() }, { merge: true });
            triggerToast('Listing updated.');
            modal.classList.remove('active');
            openAdminSection('crops_manage');
            await loadInitialCrops();
        } catch (err) {
            console.error('Failed to save crop', err);
            triggerToast(mapFirebaseError(err));
            btn.disabled = false;
            btn.textContent = 'Save';
        }
    });
}

// ===== Cart & Orders (pre-orders / purchase tracking) =====
// Cart is one doc per user: carts/{uid} = { items: [...], updated_at }.
// Placing an order groups the cart items belonging to ONE farmer into a
// new orders/{orderId} doc — fulfillment happens per-farmer, so a cart
// spanning multiple farmers becomes multiple separate orders, each placed
// individually from its own "Place Pre-Order" button in the cart modal.
//
// There's no live payment gateway. "payment_provider" just records which
// of the buyer's verified KYC mobile money providers (Orange/Africell/
// Qcell) they intend to pay with — checkout requires kyc_status ===
// 'approved' so this is a real verified value, not free text.
let cartCache = { items: [] };

function cartDocRef() {
    const db = window.firebaseDb;
    const { doc } = window.dbFns;
    const uid = window.firebaseAuth?.currentUser?.uid;
    if (!uid) return null;
    return doc(db, 'carts', uid);
}

async function loadCart() {
    const uid = window.firebaseAuth?.currentUser?.uid;
    if (!uid) { cartCache = { items: [] }; updateCartBadge(); return; }
    const { getDoc } = window.dbFns;
    try {
        const snap = await getDoc(cartDocRef());
        cartCache = snap.exists() ? snap.data() : { items: [] };
    } catch (err) {
        console.error('Failed to load cart', err);
        cartCache = { items: [] };
    }
    if (!Array.isArray(cartCache.items)) cartCache.items = [];
    updateCartBadge();
}
window.loadCart = loadCart;

async function saveCart() {
    const ref = cartDocRef();
    if (!ref) return;
    const { setDoc } = window.dbFns;
    await setDoc(ref, { items: cartCache.items, updated_at: new Date().toISOString() });
    updateCartBadge();
}

function updateCartBadge() {
    const badge = document.getElementById('cartBadge');
    if (!badge) return;
    const count = cartCache.items.reduce((sum, i) => sum + (i.quantity || 1), 0);
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count === 0;
}

async function addToCart(cropItem) {
    const uid = window.firebaseAuth?.currentUser?.uid;
    if (!uid) { triggerToast('Please sign in to add items to your cart.'); return; }
    if (!cropItem.crop_id) return;
    const existing = cartCache.items.find((i) => i.crop_id === cropItem.crop_id);
    if (existing) {
        existing.quantity = (existing.quantity || 1) + 1;
    } else {
        cartCache.items.push({ ...cropItem, quantity: 1, added_at: new Date().toISOString() });
    }
    try {
        await saveCart();
        triggerToast(`Added ${cropItem.name} to your cart.`);
    } catch (err) {
        console.error('Failed to add to cart', err);
        triggerToast(mapFirebaseError(err));
    }
}

async function updateCartItemQty(cropId, delta) {
    const item = cartCache.items.find((i) => i.crop_id === cropId);
    if (!item) return;
    item.quantity = Math.max(1, (item.quantity || 1) + delta);
    try {
        await saveCart();
        renderCartModal();
    } catch (err) {
        console.error('Failed to update cart', err);
        triggerToast(mapFirebaseError(err));
    }
}

async function removeCartItem(cropId) {
    cartCache.items = cartCache.items.filter((i) => i.crop_id !== cropId);
    try {
        await saveCart();
        renderCartModal();
    } catch (err) {
        console.error('Failed to update cart', err);
        triggerToast(mapFirebaseError(err));
    }
}

function cartGroupedByFarmer() {
    const groups = {};
    cartCache.items.forEach((item) => {
        const key = item.farmer_uid || 'unknown';
        if (!groups[key]) groups[key] = { farmer_uid: item.farmer_uid, farmer_name: item.farmer_name || 'Farmer', items: [] };
        groups[key].items.push(item);
    });
    return Object.values(groups);
}

function openCartModal() {
    document.getElementById('cartModal').classList.add('active');
    renderCartModal();
}
window.openCartModal = openCartModal;

document.getElementById('closeCartModal')?.addEventListener('click', () => document.getElementById('cartModal').classList.remove('active'));
document.getElementById('cartModal')?.addEventListener('click', (e) => { if (e.target.id === 'cartModal') document.getElementById('cartModal').classList.remove('active'); });
document.getElementById('closeCheckoutModal')?.addEventListener('click', () => document.getElementById('checkoutModal').classList.remove('active'));
document.getElementById('checkoutModal')?.addEventListener('click', (e) => { if (e.target.id === 'checkoutModal') document.getElementById('checkoutModal').classList.remove('active'); });

function renderCartModal() {
    const body = document.getElementById('cartModalBody');
    if (!body) return;
    if (!cartCache.items.length) {
        body.innerHTML = '<p class="text-muted">Your cart is empty. Browse listings and add crops you want to pre-order.</p>';
        return;
    }
    const groups = cartGroupedByFarmer();
    body.innerHTML = groups.map((g) => {
        const subtotal = g.items.reduce((sum, i) => sum + (i.price || 0) * (i.quantity || 1), 0);
        return `
            <div class="cart-farmer-group">
                <div class="cart-farmer-group-header"><i data-lucide="store"></i> ${escapeHtml(g.farmer_name)}</div>
                ${g.items.map((item) => `
                    <div class="cart-item-row">
                        <img src="${escapeHtml(item.image_url || FALLBACK_IMAGE)}" alt="${escapeHtml(item.name)}" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}'">
                        <div class="cart-item-info">
                            <div class="cart-item-name">${escapeHtml(item.name)}</div>
                            <div class="cart-item-price">SLLE ${(item.price || 0).toLocaleString()} each</div>
                        </div>
                        <div class="cart-item-qty">
                            <button type="button" data-qty-minus="${escapeHtml(item.crop_id)}" aria-label="Decrease quantity">−</button>
                            <span>${item.quantity || 1}</span>
                            <button type="button" data-qty-plus="${escapeHtml(item.crop_id)}" aria-label="Increase quantity">+</button>
                        </div>
                        <button type="button" class="cart-item-remove" data-remove="${escapeHtml(item.crop_id)}" aria-label="Remove item"><i data-lucide="trash-2"></i></button>
                    </div>
                `).join('')}
                <div class="cart-farmer-group-footer">
                    <span>Subtotal: <strong>SLLE ${subtotal.toLocaleString()}</strong></span>
                    <button type="button" class="btn-blue" data-checkout="${escapeHtml(g.farmer_uid)}">Place Pre-Order</button>
                </div>
            </div>
        `;
    }).join('');

    body.querySelectorAll('[data-qty-minus]').forEach((btn) => btn.addEventListener('click', () => updateCartItemQty(btn.getAttribute('data-qty-minus'), -1)));
    body.querySelectorAll('[data-qty-plus]').forEach((btn) => btn.addEventListener('click', () => updateCartItemQty(btn.getAttribute('data-qty-plus'), 1)));
    body.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', () => removeCartItem(btn.getAttribute('data-remove'))));
    body.querySelectorAll('[data-checkout]').forEach((btn) => btn.addEventListener('click', () => openCheckoutModal(btn.getAttribute('data-checkout'))));
    if (window.lucide) lucide.createIcons();
}

// ---- Checkout: creates one order per farmer from that farmer's cart items ----
async function openCheckoutModal(farmerUid) {
    const group = cartGroupedByFarmer().find((g) => g.farmer_uid === farmerUid);
    if (!group) return;

    const modal = document.getElementById('checkoutModal');
    const body = document.getElementById('checkoutModalBody');
    body.innerHTML = '<p class="text-muted">Loading…</p>';
    modal.classList.add('active');

    const uid = window.firebaseAuth.currentUser.uid;
    const db = window.firebaseDb;
    const { getDoc, doc } = window.dbFns;
    let kycStatus = 'not_started', kycProvider = null;
    try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (snap.exists()) {
            kycStatus = snap.data().kyc_status || 'not_started';
            kycProvider = snap.data().kyc_provider || null;
        }
    } catch (err) {
        console.error('Failed to load KYC status for checkout', err);
    }

    const subtotal = group.items.reduce((sum, i) => sum + (i.price || 0) * (i.quantity || 1), 0);

    if (kycStatus !== 'approved' || !kycProvider) {
        body.innerHTML = `
            <h3>Verify to place a pre-order</h3>
            <p class="text-muted" style="margin-bottom:1rem;">Placing a pre-order requires a verified mobile money provider on file, so the farmer knows how you intend to pay. ${kycStatus === 'pending' ? 'Your KYC application is still under review — check back soon.' : "You haven't completed KYC verification yet."}</p>
            <div style="display:flex; gap:0.75rem;">
                ${kycStatus !== 'pending' ? `<button type="button" class="btn-blue" id="checkoutStartKycBtn">Start KYC verification</button>` : ''}
                <button type="button" class="btn-outline" id="checkoutCancelBtn">Close</button>
            </div>
        `;
        document.getElementById('checkoutCancelBtn').addEventListener('click', () => modal.classList.remove('active'));
        document.getElementById('checkoutStartKycBtn')?.addEventListener('click', () => {
            modal.classList.remove('active');
            document.getElementById('cartModal').classList.remove('active');
            openKycModal();
        });
        return;
    }

    const providerInfo = KYC_PROVIDERS[kycProvider] || { label: kycProvider, color: '#666' };

    body.innerHTML = `
        <h3>Confirm pre-order — ${escapeHtml(group.farmer_name)}</h3>
        <div class="checkout-items-summary">
            ${group.items.map((i) => `<div class="checkout-item-line"><span>${i.quantity || 1} × ${escapeHtml(i.name)}</span><span>SLLE ${((i.price || 0) * (i.quantity || 1)).toLocaleString()}</span></div>`).join('')}
        </div>
        <div class="checkout-total-line"><span>Total</span><span>SLLE ${subtotal.toLocaleString()}</span></div>
        <div class="form-group">
            <label>Payment method</label>
            <div class="checkout-payment-badge" style="border-color:${providerInfo.color}; color:${providerInfo.color};"><i data-lucide="smartphone"></i> ${escapeHtml(providerInfo.label)} (verified)</div>
        </div>
        <div class="form-group">
            <label>Note for the farmer (optional)</label>
            <textarea id="checkoutNotes" rows="2" placeholder="e.g. preferred pickup date, delivery details..."></textarea>
        </div>
        <div style="display:flex; gap:0.75rem;">
            <button type="button" class="btn-blue" id="checkoutConfirmBtn">Confirm Pre-Order</button>
            <button type="button" class="btn-outline" id="checkoutCancelBtn">Cancel</button>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
    document.getElementById('checkoutCancelBtn').addEventListener('click', () => modal.classList.remove('active'));
    document.getElementById('checkoutConfirmBtn').addEventListener('click', async () => {
        const btn = document.getElementById('checkoutConfirmBtn');
        btn.disabled = true;
        btn.textContent = 'Placing order…';
        try {
            await placeOrder(group, subtotal, kycProvider, providerInfo.label, document.getElementById('checkoutNotes').value.trim());
            modal.classList.remove('active');
            document.getElementById('cartModal').classList.remove('active');
            triggerToast('Pre-order placed! Track it under "My Orders".');
        } catch (err) {
            console.error('Failed to place order', err);
            triggerToast(mapFirebaseError(err));
            btn.disabled = false;
            btn.textContent = 'Confirm Pre-Order';
        }
    });
}

async function placeOrder(group, subtotal, paymentProvider, paymentProviderLabel, notes) {
    const db = window.firebaseDb;
    const { doc, collection, setDoc } = window.dbFns;
    const user = window.firebaseAuth.currentUser;
    const now = new Date().toISOString();
    const orderRef = doc(collection(db, 'orders'));
    await setDoc(orderRef, {
        buyer_uid: user.uid,
        buyer_name: user.displayName || user.email || 'Buyer',
        farmer_uid: group.farmer_uid,
        farmer_name: group.farmer_name,
        items: group.items.map((i) => ({ crop_id: i.crop_id, name: i.name, price: i.price, quantity: i.quantity || 1, image_url: i.image_url || '' })),
        subtotal,
        payment_provider: paymentProvider,
        payment_provider_label: paymentProviderLabel,
        notes: notes || '',
        status: 'pending',
        status_history: [{ status: 'pending', at: now }],
        created_at: now,
        updated_at: now
    });

    // Remove the just-ordered items from the cart and persist.
    const orderedIds = new Set(group.items.map((i) => i.crop_id));
    cartCache.items = cartCache.items.filter((i) => !orderedIds.has(i.crop_id));
    await saveCart();
    renderCartModal();
}

// ---- Orders view: buyer's Purchases tab + farmer's Sales tab ----
const ORDER_STATUS_LABELS = { pending: 'Pending', confirmed: 'Confirmed', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled' };
const ORDER_STATUS_STEPS = ['pending', 'confirmed', 'ready', 'completed'];

function orderStatusBadgeHtml(status) {
    return `<span class="order-status-badge order-status-${escapeHtml(status)}">${escapeHtml(ORDER_STATUS_LABELS[status] || status)}</span>`;
}

function orderProgressStepsHtml(status) {
    if (status === 'cancelled') return `<div class="order-progress-cancelled"><i data-lucide="x-circle"></i> This order was cancelled</div>`;
    const currentIndex = ORDER_STATUS_STEPS.indexOf(status);
    return `<div class="order-progress-steps">
        ${ORDER_STATUS_STEPS.map((s, i) => `
            <div class="order-progress-step ${i <= currentIndex ? 'done' : ''}">
                <span class="order-progress-dot"></span>
                <span class="order-progress-label">${escapeHtml(ORDER_STATUS_LABELS[s])}</span>
            </div>
        `).join('')}
    </div>`;
}

function orderItemsSummary(items) {
    return (items || []).map((i) => `${i.quantity || 1} × ${escapeHtml(i.name)}`).join(', ');
}

function showOrdersView() {
    document.getElementById('staticPageContainer').style.display = 'none';
    document.getElementById('landingPage').style.display = 'none';
    document.getElementById('landingSections').style.display = 'none';
    document.getElementById('landingNav').style.display = 'none';
    dashboardApp.style.display = 'none';
    if (profileView) profileView.style.display = 'none';
    document.getElementById('adminDashboardApp').style.display = 'none';
    document.getElementById('ordersView').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadMyPurchases();
    loadMySales();
}
window.showOrdersView = showOrdersView;

function hideOrdersView() {
    document.getElementById('ordersView').style.display = 'none';
    window.showDashboardView?.();
}
window.hideOrdersView = hideOrdersView;

document.getElementById('ordersBackBtn')?.addEventListener('click', () => hideOrdersView());
function setActiveOrdersTab(tabId) {
    ['ordersTabPurchases', 'ordersTabSales', 'ordersTabAnalytics'].forEach((id) => document.getElementById(id)?.classList.toggle('active', id === tabId));
    document.getElementById('ordersPurchasesPanel').hidden = tabId !== 'ordersTabPurchases';
    document.getElementById('ordersSalesPanel').hidden = tabId !== 'ordersTabSales';
    document.getElementById('ordersAnalyticsPanel').hidden = tabId !== 'ordersTabAnalytics';
}
document.getElementById('ordersTabPurchases')?.addEventListener('click', () => setActiveOrdersTab('ordersTabPurchases'));
document.getElementById('ordersTabSales')?.addEventListener('click', () => setActiveOrdersTab('ordersTabSales'));
document.getElementById('ordersTabAnalytics')?.addEventListener('click', () => { setActiveOrdersTab('ordersTabAnalytics'); loadMyAnalytics(); });

async function loadMyPurchases() {
    const uid = window.firebaseAuth?.currentUser?.uid;
    const listEl = document.getElementById('ordersPurchasesList');
    if (!uid || !listEl) return;
    const db = window.firebaseDb;
    const { collection, query, where, orderBy, getDocs } = window.dbFns;
    listEl.innerHTML = '<p class="text-muted">Loading…</p>';
    try {
        const snap = await getDocs(query(collection(db, 'orders'), where('buyer_uid', '==', uid), orderBy('created_at', 'desc')));
        const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (!orders.length) {
            listEl.innerHTML = '<p class="text-muted">You haven\u2019t placed any pre-orders yet. Add listings to your cart to get started.</p>';
            return;
        }
        listEl.innerHTML = orders.map((o) => `
            <div class="order-card">
                <div class="order-card-header">
                    <div><i data-lucide="store"></i> ${escapeHtml(o.farmer_name || 'Farmer')}</div>
                    ${orderStatusBadgeHtml(o.status)}
                </div>
                <div class="order-card-items">${orderItemsSummary(o.items)}</div>
                ${orderProgressStepsHtml(o.status)}
                <div class="order-card-footer">
                    <span>Total: <strong>SLLE ${(o.subtotal || 0).toLocaleString()}</strong></span>
                    <span class="text-muted">Paying via ${escapeHtml(o.payment_provider_label || '—')}</span>
                    ${o.status === 'pending' ? `<button type="button" class="btn-delete" data-cancel-order="${o.id}">Cancel</button>` : ''}
                </div>
            </div>
        `).join('');
        listEl.querySelectorAll('[data-cancel-order]').forEach((btn) => {
            btn.addEventListener('click', () => updateOrderStatus(btn.getAttribute('data-cancel-order'), 'cancelled', loadMyPurchases));
        });
        if (window.lucide) lucide.createIcons();
    } catch (err) {
        console.error('Failed to load purchases', err);
        listEl.innerHTML = '<p class="text-muted">Could not load your orders right now.</p>';
    }
}

async function loadMySales() {
    const uid = window.firebaseAuth?.currentUser?.uid;
    const listEl = document.getElementById('ordersSalesList');
    if (!uid || !listEl) return;
    const db = window.firebaseDb;
    const { collection, query, where, orderBy, getDocs } = window.dbFns;
    listEl.innerHTML = '<p class="text-muted">Loading…</p>';
    try {
        const snap = await getDocs(query(collection(db, 'orders'), where('farmer_uid', '==', uid), orderBy('created_at', 'desc')));
        const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const actionable = orders.filter((o) => o.status === 'pending' || o.status === 'confirmed').length;
        const salesBadge = document.getElementById('ordersSalesActionBadge');
        if (salesBadge) { salesBadge.textContent = actionable; salesBadge.hidden = actionable === 0; }

        if (!orders.length) {
            listEl.innerHTML = '<p class="text-muted">No pre-orders on your listings yet.</p>';
            return;
        }
        listEl.innerHTML = orders.map((o) => `
            <div class="order-card">
                <div class="order-card-header">
                    <div><i data-lucide="user"></i> ${escapeHtml(o.buyer_name || 'Buyer')}</div>
                    ${orderStatusBadgeHtml(o.status)}
                </div>
                <div class="order-card-items">${orderItemsSummary(o.items)}</div>
                ${o.notes ? `<div class="order-card-note"><i data-lucide="message-square"></i> ${escapeHtml(o.notes)}</div>` : ''}
                ${orderProgressStepsHtml(o.status)}
                <div class="order-card-footer">
                    <span>Total: <strong>SLLE ${(o.subtotal || 0).toLocaleString()}</strong></span>
                    <span class="text-muted">Paying via ${escapeHtml(o.payment_provider_label || '—')}</span>
                    <div class="order-card-actions">
                        ${o.status === 'pending' ? `<button type="button" class="btn-blue" data-advance-order="${o.id}" data-next="confirmed">Confirm</button><button type="button" class="btn-delete" data-cancel-order="${o.id}">Decline</button>` : ''}
                        ${o.status === 'confirmed' ? `<button type="button" class="btn-blue" data-advance-order="${o.id}" data-next="ready">Mark Ready</button>` : ''}
                        ${o.status === 'ready' ? `<button type="button" class="btn-blue" data-advance-order="${o.id}" data-next="completed">Mark Completed</button>` : ''}
                    </div>
                </div>
            </div>
        `).join('');
        listEl.querySelectorAll('[data-advance-order]').forEach((btn) => {
            btn.addEventListener('click', () => updateOrderStatus(btn.getAttribute('data-advance-order'), btn.getAttribute('data-next'), loadMySales));
        });
        listEl.querySelectorAll('[data-cancel-order]').forEach((btn) => {
            btn.addEventListener('click', () => updateOrderStatus(btn.getAttribute('data-cancel-order'), 'cancelled', loadMySales));
        });
        if (window.lucide) lucide.createIcons();
    } catch (err) {
        console.error('Failed to load sales', err);
        listEl.innerHTML = '<p class="text-muted">Could not load incoming orders right now.</p>';
    }
}

async function updateOrderStatus(orderId, newStatus, refreshFn) {
    if (newStatus === 'cancelled' && !window.confirm('Cancel this order?')) return;
    const db = window.firebaseDb;
    const { doc, getDoc, setDoc } = window.dbFns;
    try {
        const ref = doc(db, 'orders', orderId);
        const snap = await getDoc(ref);
        const history = snap.exists() ? (snap.data().status_history || []) : [];
        await setDoc(ref, {
            status: newStatus,
            updated_at: new Date().toISOString(),
            status_history: [...history, { status: newStatus, at: new Date().toISOString() }]
        }, { merge: true });
        triggerToast(`Order marked as ${ORDER_STATUS_LABELS[newStatus] || newStatus}.`);
        refreshFn?.();
    } catch (err) {
        console.error('Failed to update order status', err);
        triggerToast(mapFirebaseError(err));
    }
}

// ===== Analytics (shared helpers + user-facing + admin) =====
// All computed client-side from the crops/orders/users collections that
// already exist — no separate analytics backend. Charts render with
// Chart.js (loaded via CDN in index.html). Instances are tracked by
// canvas id so re-rendering a panel (e.g. switching tabs back and forth)
// destroys the old chart first instead of silently stacking canvases.
const analyticsChartInstances = {};
function destroyChartIfExists(canvasId) {
    if (analyticsChartInstances[canvasId]) {
        analyticsChartInstances[canvasId].destroy();
        delete analyticsChartInstances[canvasId];
    }
}
function renderLineChart(canvasId, labels, datasets) {
    destroyChartIfExists(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx || !window.Chart) return;
    analyticsChartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: datasets.map((d) => ({ ...d, tension: 0.35, fill: false, borderWidth: 2, pointRadius: 3 })) },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } }, scales: { y: { beginAtZero: true } } }
    });
}
function renderDoughnutChart(canvasId, labels, data, colors) {
    destroyChartIfExists(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx || !window.Chart) return;
    analyticsChartInstances[canvasId] = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: colors }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
    });
}
function renderBarChart(canvasId, labels, data, color) {
    destroyChartIfExists(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx || !window.Chart) return;
    analyticsChartInstances[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ data, backgroundColor: color, borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
}
function lastNMonthsLabels(n) {
    const labels = [], keys = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        labels.push(d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }));
        keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return { labels, keys };
}
function bucketByMonth(items, dateField, keys, valueFn) {
    const buckets = Object.fromEntries(keys.map((k) => [k, 0]));
    items.forEach((item) => {
        const raw = item[dateField];
        if (!raw) return;
        const d = new Date(raw);
        if (isNaN(d)) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (key in buckets) buckets[key] += valueFn(item);
    });
    return keys.map((k) => buckets[k]);
}
function analyticsKpiCardHtml(icon, label, value) {
    return `<div class="analytics-kpi-card"><div class="analytics-kpi-icon"><i data-lucide="${icon}"></i></div><div class="analytics-kpi-value">${value}</div><div class="analytics-kpi-label">${escapeHtml(label)}</div></div>`;
}
const ORDER_STATUS_ALL = ['pending', 'confirmed', 'ready', 'completed', 'cancelled'];
const ORDER_STATUS_CHART_COLORS = ['#92400e', '#2563eb', '#7c3aed', '#16a34a', '#dc2626'];
const ORDER_STATUS_CHART_LABELS = ['Pending', 'Confirmed', 'Ready', 'Completed', 'Cancelled'];

// ---- User-facing analytics: auto-detects farmer / buyer / both ----
async function loadMyAnalytics() {
    const uid = window.firebaseAuth?.currentUser?.uid;
    const panel = document.getElementById('ordersAnalyticsPanel');
    if (!uid || !panel) return;
    panel.innerHTML = '<p class="text-muted">Loading…</p>';

    const db = window.firebaseDb;
    const { collection, query, where, getDocs } = window.dbFns;

    try {
        const [myCropsSnap, salesSnap, purchasesSnap] = await Promise.all([
            getDocs(query(collection(db, 'crops'), where('submitted_by', '==', uid))),
            getDocs(query(collection(db, 'orders'), where('farmer_uid', '==', uid))),
            getDocs(query(collection(db, 'orders'), where('buyer_uid', '==', uid)))
        ]);
        const myCrops = myCropsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const sales = salesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const purchases = purchasesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const isFarmer = myCrops.length > 0;
        const isBuyer = purchases.length > 0;

        if (!isFarmer && !isBuyer) {
            panel.innerHTML = '<p class="text-muted">No activity yet — list a crop to sell, or add listings to your cart to start buying, and your analytics will show up here.</p>';
            return;
        }

        let html = '';
        if (isFarmer) {
            html += `
                <h3><i data-lucide="store"></i> As a Farmer</h3>
                <div class="analytics-kpi-grid" id="farmerKpiGrid"></div>
                <div class="analytics-charts-grid">
                    <div class="analytics-chart-card"><h4>Revenue (last 6 months)</h4><div class="analytics-chart-wrap"><canvas id="farmerRevenueChart"></canvas></div></div>
                    <div class="analytics-chart-card"><h4>Orders by Status</h4><div class="analytics-chart-wrap"><canvas id="farmerOrdersStatusChart"></canvas></div></div>
                </div>
                <div class="analytics-table-card"><h4>Views by Listing</h4><div id="farmerViewsTable"></div></div>
            `;
        }
        if (isBuyer) {
            html += `
                <h3 style="${isFarmer ? 'margin-top:2.5rem;' : ''}"><i data-lucide="shopping-bag"></i> As a Buyer</h3>
                <div class="analytics-kpi-grid" id="buyerKpiGrid"></div>
                <div class="analytics-charts-grid">
                    <div class="analytics-chart-card"><h4>Spending (last 6 months)</h4><div class="analytics-chart-wrap"><canvas id="buyerSpendingChart"></canvas></div></div>
                    <div class="analytics-chart-card"><h4>Orders by Status</h4><div class="analytics-chart-wrap"><canvas id="buyerOrdersStatusChart"></canvas></div></div>
                </div>
            `;
        }
        panel.innerHTML = html;

        const { labels, keys } = lastNMonthsLabels(6);

        if (isFarmer) {
            const completed = sales.filter((o) => o.status === 'completed');
            const totalRevenue = completed.reduce((s, o) => s + (o.subtotal || 0), 0);
            const totalViews = myCrops.reduce((s, c) => s + (c.view_count || 0), 0);
            const activeListings = myCrops.filter((c) => c.status === 'approved').length;
            document.getElementById('farmerKpiGrid').innerHTML = [
                analyticsKpiCardHtml('banknote', 'Total Revenue', `SLLE ${totalRevenue.toLocaleString()}`),
                analyticsKpiCardHtml('package', 'Total Orders', sales.length),
                analyticsKpiCardHtml('eye', 'Total Views', totalViews),
                analyticsKpiCardHtml('store', 'Active Listings', activeListings)
            ].join('');
            renderLineChart('farmerRevenueChart', labels, [{ label: 'Revenue (SLLE)', data: bucketByMonth(completed, 'created_at', keys, (o) => o.subtotal || 0), borderColor: '#16a34a', backgroundColor: '#16a34a' }]);
            renderDoughnutChart('farmerOrdersStatusChart', ORDER_STATUS_CHART_LABELS, ORDER_STATUS_ALL.map((s) => sales.filter((o) => o.status === s).length), ORDER_STATUS_CHART_COLORS);
            const viewsSorted = [...myCrops].sort((a, b) => (b.view_count || 0) - (a.view_count || 0)).slice(0, 8);
            document.getElementById('farmerViewsTable').innerHTML = viewsSorted.length
                ? `<table class="analytics-table"><tbody>${viewsSorted.map((c) => `<tr><td>${escapeHtml(c.name || 'Listing')}</td><td>${(c.view_count || 0).toLocaleString()} views</td></tr>`).join('')}</tbody></table>`
                : '<p class="text-muted">No views yet.</p>';
        }

        if (isBuyer) {
            const completedPurchases = purchases.filter((o) => o.status === 'completed');
            const totalSpent = completedPurchases.reduce((s, o) => s + (o.subtotal || 0), 0);
            const activePreorders = purchases.filter((o) => ['pending', 'confirmed', 'ready'].includes(o.status)).length;
            document.getElementById('buyerKpiGrid').innerHTML = [
                analyticsKpiCardHtml('wallet', 'Total Spent', `SLLE ${totalSpent.toLocaleString()}`),
                analyticsKpiCardHtml('shopping-bag', 'Total Orders', purchases.length),
                analyticsKpiCardHtml('clock', 'Active Pre-Orders', activePreorders)
            ].join('');
            renderLineChart('buyerSpendingChart', labels, [{ label: 'Spending (SLLE)', data: bucketByMonth(completedPurchases, 'created_at', keys, (o) => o.subtotal || 0), borderColor: '#2563eb', backgroundColor: '#2563eb' }]);
            renderDoughnutChart('buyerOrdersStatusChart', ORDER_STATUS_CHART_LABELS, ORDER_STATUS_ALL.map((s) => purchases.filter((o) => o.status === s).length), ORDER_STATUS_CHART_COLORS);
        }

        if (window.lucide) lucide.createIcons();
    } catch (err) {
        console.error('Failed to load analytics', err);
        panel.innerHTML = '<p class="text-muted">Could not load analytics right now.</p>';
    }
}

// ---- Admin analytics: platform growth + marketplace health ----
async function renderAdminAnalytics(panel) {
    panel.innerHTML = '<p class="text-muted">Loading analytics…</p>';
    const db = window.firebaseDb;
    const { collection, getDocs } = window.dbFns;

    try {
        const [usersSnap, cropsSnap, ordersSnap] = await Promise.all([
            getDocs(collection(db, 'users')),
            getDocs(collection(db, 'crops')),
            getDocs(collection(db, 'orders'))
        ]);
        const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const crops = cropsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const orders = ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const completedOrders = orders.filter((o) => o.status === 'completed');
        const gmv = completedOrders.reduce((s, o) => s + (o.subtotal || 0), 0);
        const activeListings = crops.filter((c) => c.status === 'approved').length;

        panel.innerHTML = `
            <h3>Platform Analytics</h3>
            <div class="analytics-kpi-grid">
                ${analyticsKpiCardHtml('users', 'Total Users', users.length)}
                ${analyticsKpiCardHtml('store', 'Active Listings', activeListings)}
                ${analyticsKpiCardHtml('package', 'Total Orders', orders.length)}
                ${analyticsKpiCardHtml('banknote', 'Completed Revenue (GMV)', `SLLE ${gmv.toLocaleString()}`)}
            </div>
            <div class="analytics-charts-grid">
                <div class="analytics-chart-card analytics-chart-wide"><h4>Platform Growth (last 6 months)</h4><div class="analytics-chart-wrap"><canvas id="adminGrowthChart"></canvas></div></div>
                <div class="analytics-chart-card"><h4>KYC Funnel</h4><div class="analytics-chart-wrap"><canvas id="adminKycFunnelChart"></canvas></div></div>
                <div class="analytics-chart-card"><h4>Orders by Status</h4><div class="analytics-chart-wrap"><canvas id="adminOrdersStatusChart"></canvas></div></div>
                <div class="analytics-chart-card"><h4>Top Crops by Revenue</h4><div class="analytics-chart-wrap"><canvas id="adminTopCropsChart"></canvas></div></div>
                <div class="analytics-chart-card"><h4>Top Regions</h4><div class="analytics-chart-wrap"><canvas id="adminTopRegionsChart"></canvas></div></div>
            </div>
        `;

        const { labels, keys } = lastNMonthsLabels(6);
        renderLineChart('adminGrowthChart', labels, [
            { label: 'New Users', data: bucketByMonth(users, 'created_at', keys, () => 1), borderColor: '#2563eb', backgroundColor: '#2563eb' },
            { label: 'New Listings', data: bucketByMonth(crops, 'created_at', keys, () => 1), borderColor: '#16a34a', backgroundColor: '#16a34a' },
            { label: 'New Orders', data: bucketByMonth(orders, 'created_at', keys, () => 1), borderColor: '#92400e', backgroundColor: '#92400e' }
        ]);

        const kycCounts = {
            Approved: users.filter((u) => u.kyc_status === 'approved').length,
            Pending: users.filter((u) => u.kyc_status === 'pending').length,
            Rejected: users.filter((u) => u.kyc_status === 'rejected').length,
            'Not started': users.filter((u) => !u.kyc_status || u.kyc_status === 'not_started').length
        };
        renderDoughnutChart('adminKycFunnelChart', Object.keys(kycCounts), Object.values(kycCounts), ['#16a34a', '#92400e', '#dc2626', '#94a3b8']);
        renderDoughnutChart('adminOrdersStatusChart', ORDER_STATUS_CHART_LABELS, ORDER_STATUS_ALL.map((s) => orders.filter((o) => o.status === s).length), ORDER_STATUS_CHART_COLORS);

        const revenueByCrop = {};
        orders.forEach((o) => (o.items || []).forEach((i) => {
            revenueByCrop[i.name] = (revenueByCrop[i.name] || 0) + (i.price || 0) * (i.quantity || 1);
        }));
        const topCrops = Object.entries(revenueByCrop).sort((a, b) => b[1] - a[1]).slice(0, 6);
        renderBarChart('adminTopCropsChart', topCrops.map((c) => c[0]), topCrops.map((c) => c[1]), '#16a34a');

        const regionCounts = {};
        crops.forEach((c) => { const loc = c.location || 'Unknown'; regionCounts[loc] = (regionCounts[loc] || 0) + 1; });
        const topRegions = Object.entries(regionCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
        renderBarChart('adminTopRegionsChart', topRegions.map((r) => r[0]), topRegions.map((r) => r[1]), '#2563eb');

        if (window.lucide) lucide.createIcons();
    } catch (err) {
        console.error('Failed to load admin analytics', err);
        panel.innerHTML = '<p class="text-muted">Could not load analytics right now.</p>';
    }
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
    const { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile, sendEmailVerification } = window.authFns;
    const { collection, getDocs, doc, setDoc } = window.dbFns;

    // Picks up the result of a Google redirect sign-in if the page just
    // loaded after being bounced back from Google. Fires in the background;
    // onAuthStateChanged below handles showing the dashboard once auth
    // state resolves, so this doesn't need to block the rest of init.
    handleGoogleRedirectResult(auth, db);

    // Returns a logged-in user from the marketing landing page (reached via
    // a footer link) back to their dashboard.
    function showDashboardView() {
        document.getElementById('staticPageContainer').style.display = 'none';
        document.getElementById('landingSections').style.display = 'none';
        landingPage.style.display = 'none';
        if (profileView) profileView.style.display = 'none';
        dashboardApp.style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    window.showDashboardView = showDashboardView;

    // Renders the "logged in" state of the navbar. Shared by the auth-state
    // observer and by the register handler below (registration needs to
    // re-render immediately after setting displayName, since updateProfile()
    // doesn't trigger onAuthStateChanged again on its own).
    //
    // FIX: previously this template never actually rendered a
    // #navKycAdminBtn element, so the admin-only wiring further down
    // (`document.getElementById('navKycAdminBtn')`) always found nothing
    // and silently no-opped — there was no way for the admin to open
    // adminKycModal / loadAdminKycList() from the dashboard. The button is
    // now rendered here (admin-only), matching the existing
    // .btn-kyc-admin / .btn-kyc-admin-badge styles and the #adminKycBadge
    // id that updateAdminKycBadge() already expects.
    async function renderAuthedNav(user) {
        const firstName = escapeHtml(await getFirstName(user));
        const photoUrl = await getAvatarPhotoUrl(user);
        const isAdmin = user.uid === ADMIN_UID;
        navMenu.innerHTML = `
            ${!isAdmin ? '<button id="navSupportBtn" class="btn-outline" title="Contact Support"><i data-lucide="headset"></i> Support</button>' : ''}
            ${!isAdmin ? `
            <div class="notif-wrapper">
                <button id="cartBtn" class="notif-bell-btn" type="button" aria-label="Cart">
                    <i data-lucide="shopping-cart"></i>
                    <span id="cartBadge" class="notif-badge" hidden>0</span>
                </button>
            </div>` : ''}
            <div class="notif-wrapper">
                <button id="chatBellBtn" class="notif-bell-btn" type="button" aria-label="Messages">
                    <i data-lucide="message-circle"></i>
                    <span id="chatBadge" class="notif-badge" hidden>0</span>
                </button>
            </div>
            <div class="notif-wrapper">
                <button id="notifBellBtn" class="notif-bell-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Notifications">
                    <i data-lucide="bell"></i>
                    <span id="notifBadge" class="notif-badge" hidden>0</span>
                </button>
                <div id="notifDropdown" class="notif-dropdown" hidden>
                    <div class="notif-dropdown-header">
                        <span>Notifications</span>
                        <button id="notifMarkAllBtn" type="button" class="notif-mark-all">Mark all read</button>
                    </div>
                    <div id="notifDropdownList" class="notif-dropdown-list"><div class="notif-dropdown-empty">Loading…</div></div>
                </div>
            </div>
            ${isAdmin ? `
            <button id="navKycAdminBtn" class="btn-kyc-admin" type="button" title="KYC Verification Requests">
                <i data-lucide="shield-check"></i> KYC
                <span id="adminKycBadge" class="btn-kyc-admin-badge" hidden>0</span>
            </button>
            <button id="navAdminBtn" class="btn-outline" type="button" title="Admin Dashboard">
                <i data-lucide="settings"></i> Admin
            </button>` : ''}
            ${!isAdmin ? '<button id="navOrdersBtn" class="btn-outline" type="button" title="My Orders"><i data-lucide="package"></i> Orders</button>' : ''}
            <button id="navDashboardBtn" class="btn-outline" title="Back to Marketplace"><i data-lucide="store"></i> Marketplace</button>
            <button id="navProfileBtn" class="nav-profile-pill" type="button" title="Your profile">
                ${avatarHtml(firstName || user.email || 'User', user.uid, photoUrl)}
                <span>Hi, ${firstName}</span>
            </button>
            <button id="navLogoutBtn" class="btn-outline"><i data-lucide="log-out"></i> Log Out</button>
        `;
        document.getElementById('navDashboardBtn').addEventListener('click', showDashboardView);
        document.getElementById('navProfileBtn').addEventListener('click', () => showProfileView(user));
        setupNotificationBell();
        document.getElementById('chatBellBtn').addEventListener('click', () => openMessagesModal());
        document.getElementById('cartBtn')?.addEventListener('click', () => openCartModal());
        if (!isAdmin) updateCartBadge();
        document.getElementById('navOrdersBtn')?.addEventListener('click', () => showOrdersView());
        document.getElementById('navSupportBtn')?.addEventListener('click', () => {
            openOrCreateChat({ otherUid: ADMIN_UID, otherLabel: 'Support', type: 'support' });
        });
        // Admin-only: open the KYC review panel and keep the pending
        // count badge live while the admin session is active.
        const kycAdminBtn = document.getElementById('navKycAdminBtn');
        if (kycAdminBtn) {
            kycAdminBtn.addEventListener('click', () => openAdminKycModal());
            // Kick off the live pending-count badge for this admin session.
            window.updateAdminKycBadge?.();
            if (window.lucide) lucide.createIcons();
        }
        document.getElementById('navAdminBtn')?.addEventListener('click', () => showAdminDashboardView());
        document.getElementById('navLogoutBtn').addEventListener('click', async () => {
            try {
                await signOut(auth);
                triggerToast('You have been securely logged out.');
            } catch (err) {
                console.error('Sign out failed', err);
                triggerToast(mapFirebaseError(err));
            }
        });
    }
    // Exposed globally so handlers defined outside initApp's scope (the
    // profile-edit form submit and the avatar upload handler, both declared
    // at module top-level below) can refresh the navbar without a
    // ReferenceError. Internal calls within initApp keep using the plain
    // `renderAuthedNav(...)` reference above.
    window.renderAuthedNav = renderAuthedNav;

    // Auth state observer
    onAuthStateChanged(auth, async (user) => {
        // Keeps the hero banner's message in sync with the real auth state.
        // Without this, logging out while browsing footer/landing content
        // (the top navbar's Log Out button is always reachable, regardless
        // of which view is showing) would leave the hero saying "You're
        // signed in" even after the user had just logged out.
        window.syncHeroTextForAuthState?.();

        if (user) {
            // User is signed in
            landingPage.style.display = 'none';
            dashboardApp.style.display = 'block';

            await renderAuthedNav(user);

            // Refresh emailVerified/uid off the server rather than the
            // cached user object, so a user who just verified their email
            // in another tab immediately sees the right buttons here too.
            try { await user.reload(); } catch (err) { console.warn('Could not refresh user before role check', err); }

            const isAdmin = user.uid === ADMIN_UID;
            const isVerifiedFarmer = !isAdmin && user.emailVerified;

            // The "Add Listing" button serves two roles depending on who's
            // signed in: for the admin it publishes instantly, for any
            // other verified user it submits for approval. Which one
            // applies is re-checked server-side by the Firestore rules on
            // 'crops' — this client-side branch only controls the button
            // label/visibility and what status the write requests.
            if (addListingBtn) {
                addListingBtn.hidden = !(isAdmin || isVerifiedFarmer);
                if (isAdmin) {
                    addListingBtn.innerHTML = '<i data-lucide="plus"></i> Add Listing';
                } else {
                    addListingBtn.innerHTML = '<i data-lucide="plus"></i> Sell Your Crop';
                }
            }

            if (pendingApprovalsSection) pendingApprovalsSection.hidden = !isAdmin;
            if (mySubmissionsSection) mySubmissionsSection.hidden = isAdmin;

            if (isAdmin) {
                loadPendingApprovals();
            } else if (isVerifiedFarmer) {
                loadMySubmissions(user.uid);
            }

            // Load initial crops and the notification bar for signed-in user
            await loadInitialCrops();
            loadNotifications();
            if (!isAdmin) loadCart();
            await initE2EE(user.uid);
            subscribeToChats(user.uid);
            currentPresenceUid = user.uid;
            initPresence(user.uid);

            // (Re)start the inactivity clock now that someone is signed in.
            resetInactivityTimer();
        } else {
            // No user
            landingPage.style.display = 'block';
            dashboardApp.style.display = 'none';
            if (addListingBtn) addListingBtn.hidden = true;
            if (pendingApprovalsSection) pendingApprovalsSection.hidden = true;
            if (mySubmissionsSection) mySubmissionsSection.hidden = true;
            unsubscribeFromChats();
            closeMessagesModal();
            clearE2eeSession();
            teardownPresence(currentPresenceUid);
            currentPresenceUid = null;
            currentNotifications = [];
            readNotificationIdsCache = new Set();
            cartCache = { items: [] };
            navMenu.innerHTML = `<button id="navLoginBtn" class="btn-outline">Log In</button>`;
            document.getElementById('navLoginBtn').addEventListener('click', () => openModal('login'));

            // No one is signed in anymore — nothing left to time out.
            clearInactivityTimer();
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
            const uid = cred.user.uid;

            // Close and toast immediately — the account already exists at
            // this point, so nothing below should hold up the modal
            // closing. Everything else here (profile doc, display name,
            // verification email) finishes in the background.
            closeModal();
            triggerToast("Account created! We've sent a verification link to your email — you'll need to verify it before contacting farmers.");

            // Set the Auth profile's displayName to the user's first name so
            // the navbar (and any future onAuthStateChanged callback) shows
            // "Hi, <first name>" instead of the email address.
            const firstName = name.trim().split(/\s+/)[0] || 'there';
            try {
                await updateProfile(cred.user, { displayName: firstName });
            } catch (err) {
                console.warn('Failed to set display name', err);
            }

            landingPage.style.display = "none";
            dashboardApp.style.display = "block";
            await loadInitialCrops();

            // onAuthStateChanged already fired (before displayName was set)
            // and rendered the navbar once — re-render it now that the
            // profile has the first name, since updateProfile() alone
            // doesn't trigger another onAuthStateChanged callback.
            await renderAuthedNav(cred.user);

            // create a user profile document
            try {
                await setDoc(doc(db, 'users', uid), { full_name: name, email, created_at: new Date().toISOString() });
            } catch (err) {
                console.warn('Failed to write user profile', err);
            }

            // Send the verification email. Contacting farmers (phone
            // link / "Contact Farmer" button) is gated on emailVerified,
            // so new accounts need this before they can reach out to anyone.
            try {
                await sendEmailVerification(cred.user);
            } catch (err) {
                console.warn('Failed to send verification email', err);
            }
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
        const rememberMe = document.getElementById('rememberMeCheckbox')?.checked;

        try {
            // Must be set BEFORE the sign-in call — it controls how the
            // session that's about to be created is stored, not the
            // current one. Local persistence survives closing the
            // browser entirely; session persistence (the default) signs
            // the user out once the last tab is closed.
            await setAuthPersistence(auth, rememberMe);
            await signInWithEmailAndPassword(auth, email, password);
            closeModal();
            landingPage.style.display = "none";
            dashboardApp.style.display = "block";
            await loadInitialCrops();
        } catch (err) {
            console.error('Sign in failed', err);
            triggerToast(mapFirebaseError(err));
        }
    });

    // Google Sign-In — same handler wired to both the Sign In tab's button
    // and the Create Account tab's button. This navigates away from the
    // page immediately (redirect flow), so there's no modal-closing logic
    // to run here — the user comes right back to this page once signed in.
    // Only the Sign In tab has a "Remember me" checkbox (account creation
    // always starts a normal session), so the Create Account tab's Google
    // button just passes `false`.
    document.getElementById('googleSignInBtn')?.addEventListener('click', async () => {
        await setAuthPersistence(auth, document.getElementById('rememberMeCheckbox')?.checked);
        signInWithGoogleHandler(auth);
    });
    document.getElementById('googleSignUpBtn')?.addEventListener('click', async () => {
        await setAuthPersistence(auth, false);
        signInWithGoogleHandler(auth);
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

    // Blog modal
    document.getElementById('closeBlogModal')?.addEventListener('click', () => blogModal.classList.remove('active'));
    blogModal?.addEventListener('click', (e) => { if (e.target === blogModal) blogModal.classList.remove('active'); });

    // Add Listing modal (admin-only — button itself stays hidden for
    // everyone else, see the ADMIN_UID check in the auth-state observer)
    addListingBtn?.addEventListener('click', () => {
        const isAdmin = window.firebaseAuth?.currentUser?.uid === ADMIN_UID;
        if (isAdmin) {
            addListingModalTitle.textContent = 'Add Listing';
            addListingModalSubtitle.textContent = "Creates the public listing and the farmer's contact info together, so contact details are never missing.";
            addListingSubmitBtn.textContent = 'Publish Listing';
        } else {
            addListingModalTitle.textContent = 'Sell Your Crop';
            addListingModalSubtitle.textContent = "Submit your listing for review — it'll go live once approved.";
            addListingSubmitBtn.textContent = 'Submit for Review';
        }
        addListingModal.classList.add('active');
    });
    document.getElementById('closeAddListingModal')?.addEventListener('click', () => addListingModal.classList.remove('active'));
    addListingModal?.addEventListener('click', (e) => { if (e.target === addListingModal) addListingModal.classList.remove('active'); });
    addListingForm?.addEventListener('submit', handleAddListingSubmit);

    // Messages modal
    document.getElementById('closeMessagesModal')?.addEventListener('click', closeMessagesModal);
    messagesModal?.addEventListener('click', (e) => { if (e.target === messagesModal) closeMessagesModal(); });
    document.getElementById('chatBackBtn')?.addEventListener('click', () => {
        if (threadUnsubscribe) { threadUnsubscribe(); threadUnsubscribe = null; }
        activeChatId = null;
        chatThreadView.hidden = true;
        chatListView.hidden = false;
        const chatEmptyState = document.getElementById('chatEmptyState');
        if (chatEmptyState) chatEmptyState.hidden = false;
        renderChatList(window.firebaseAuth?.currentUser?.uid);
    });
    chatMessageForm?.addEventListener('submit', handleSendChatMessage);

    document.getElementById('adminBackBtn')?.addEventListener('click', () => hideAdminDashboardView());

    // Blog posts are public marketing content, so load them regardless of
    // sign-in state (unlike crop listings, which only load once a user is
    // authenticated).
    loadBlogPosts();
    // Same applies to the rest of the landing page copy — hero, about,
    // services, etc. — which is now admin-editable via Firestore.
    loadSiteContent();

    // Newsletter signup — writes to a 'newsletter_subscribers' Firestore
    // collection, using the email itself as the document ID so re-submitting
    // the same address just refreshes the timestamp instead of creating a
    // duplicate. NOTE: this form is public (pre-login), so your Firestore
    // rules need to allow unauthenticated creates on this collection, e.g.
    // allow create: if true; allow read, update, delete: if false;
    const newsletterForm = document.getElementById('newsletterForm');
    newsletterForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const emailInput = document.getElementById('newsletterEmail');
        const submitBtn = document.getElementById('newsletterSubmitBtn');
        const email = emailInput.value.trim().toLowerCase();

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            triggerToast('Please enter a valid email address.');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Subscribing…';
        try {
            await setDoc(doc(db, 'newsletter_subscribers', email), {
                email,
                subscribed_at: new Date().toISOString()
            }, { merge: true });
            triggerToast("You're subscribed! Thanks for joining our newsletter.");
            newsletterForm.reset();
        } catch (err) {
            console.error('Newsletter signup failed', err);
            triggerToast(mapFirebaseError(err));
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Subscribe';
        }
    });

    // NOTE: previously this function also wired up #btnStartLogin,
    // #btnStartRegister, #btnCtaLogin, #btnCtaRegister, #navToggle/#navLinks,
    // .nav-page-link, and #contactForm. None of those elements exist in the
    // current index.html (the mobile menu is #mobileToggle/#mobileMenu and
    // the landing page has no #contactForm) — that was dead code left over
    // from an earlier version of the markup and has been removed. The
    // current mobile menu and in-page nav links are already handled by the
    // "Landing page interactivity" inline script in index.html.

    // Load initial UI state: we rely on onAuthStateChanged to set the proper view
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
