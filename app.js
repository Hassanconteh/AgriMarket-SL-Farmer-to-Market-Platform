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

// Resolves the photo to show for a user. Real Auth photoURLs (e.g. from
// Google Sign-In) take priority; otherwise falls back to the base64
// photo_url saved on the user's Firestore doc by the avatar upload flow
// (see "Profile photo upload" below), since that flow intentionally does
// not set user.photoURL.
async function getAvatarPhotoUrl(user) {
    if (user?.photoURL) return user.photoURL;
    try {
        const { doc, getDoc } = window.dbFns;
        const db = window.firebaseDb;
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) return snap.data().photo_url || '';
    } catch (err) {
        console.warn('Could not look up stored profile photo', err);
    }
    return '';
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
                    ${location ? `<span class="badge badge-location"><i class="fa-solid fa-location-dot"></i> ${location}</span>` : ''}
                    ${category ? `<span class="badge badge-category">${category}</span>` : ''}
                </div>
                <h3 class="card-title">${name}</h3>
                <span class="card-price">SLLE ${Number(item.price || 0).toLocaleString()}</span>
                <button type="button" class="btn-contact" data-crop-id="${cropId}"><i class="fa-solid fa-phone"></i> Contact Farmer</button>
                ${showMessageSeller ? `<button type="button" class="btn-message-seller" data-action="message-seller" data-id="${cropId}"><i class="fa-solid fa-comment-dots"></i> Message Seller</button>` : ''}
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
    });
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
    info: 'fa-circle-info',
    success: 'fa-circle-check',
    warning: 'fa-triangle-exclamation',
    urgent: 'fa-bell'
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
            <div class="notif-row-icon-wrap notif-icon-${type}"><i class="fa-solid ${NOTIFICATION_ICONS[type]}"></i></div>
            <div class="notif-row-body">
                <div class="notif-row-title">${isUnread ? '<span class="notif-unread-dot"></span>' : ''}${title}</div>
                ${message ? `<div class="notif-row-message">${message}</div>` : ''}
                ${dateStr ? `<div class="notif-row-date">${dateStr}</div>` : ''}
                ${linkUrl ? `<a href="${linkUrl}" target="_blank" rel="noopener noreferrer" class="notif-row-link">${linkText} <i class="fa-solid fa-arrow-up-right-from-square"></i></a>` : ''}
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
                    <button type="button" class="blog-read-more">Read more <i class="fa-solid fa-arrow-right"></i></button>
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
                    ${location ? `<span class="badge badge-location"><i class="fa-solid fa-location-dot"></i> ${location}</span>` : ''}
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
                    ${location ? `<span class="badge badge-location"><i class="fa-solid fa-location-dot"></i> ${location}</span>` : ''}
                    ${category ? `<span class="badge badge-category">${category}</span>` : ''}
                </div>
                <h3 class="card-title">${name}</h3>
                <span class="card-price">SLLE ${Number(item.price || 0).toLocaleString()}</span>
                ${adminComment && (status === 'rejected' || status === 'pending') ? `<p class="admin-comment-note"><i class="fa-solid fa-comment-dots"></i> <strong>Admin note:</strong> ${adminComment}</p>` : ''}
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
    badge.innerHTML = isEncrypted ? '<i class="fa-solid fa-lock"></i>' : '<i class="fa-solid fa-lock-open"></i>';
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
    btn.innerHTML = isMaximized ? '<i class="fa-solid fa-compress"></i>' : '<i class="fa-solid fa-expand"></i>';
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
        chatListContainer.innerHTML = '<div class="chat-list-empty"><i class="fa-regular fa-comment"></i><p>No conversations yet</p></div>';
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
        chatMessagesContainer.innerHTML = '<div class="chat-messages-empty"><i class="fa-regular fa-comment-dots"></i><p>Say hello 👋</p></div>';
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

async function loadProfileView(user) {
    const db = window.firebaseDb;
    const { doc, getDoc } = window.dbFns;

    let profileData = {};
    try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        console.log('[avatar-load] doc exists?', snap.exists(), 'uid:', user.uid);
        if (snap.exists()) profileData = snap.data();
        console.log('[avatar-load] profileData.photo_url present?', !!profileData.photo_url, 'length:', profileData.photo_url?.length);
    } catch (err) {
        console.warn('Could not load profile', err);
        console.log('[avatar-load] getDoc FAILED:', err);
    }

    const displayName = user.displayName || profileData.full_name || '';
    const photoUrl = user.photoURL || profileData.photo_url || '';
    console.log('[avatar-load] user.photoURL:', user.photoURL, '| final photoUrl used, length:', photoUrl.length);

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
    console.log('[avatar] change event fired');
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) { console.log('[avatar] no file selected, stopping'); return; }
    console.log('[avatar] file picked:', file.name, file.type, file.size);

    const user = window.firebaseAuth?.currentUser;
    if (!user) { console.log('[avatar] no signed-in user, stopping'); return; }

    if (!file.type.startsWith('image/')) {
        console.log('[avatar] rejected: not an image type');
        triggerToast('Please choose an image file.');
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        console.log('[avatar] rejected: file over 5MB');
        triggerToast('Image must be under 5MB.');
        return;
    }

    const avatarEl = document.getElementById('profileAvatarLg');
    console.log('[avatar] avatarEl found?', !!avatarEl);
    const previousHtml = avatarEl?.innerHTML;
    // Show the picked image immediately (before resizing/saving finishes) so
    // the UI feels instant; reverts to the previous avatar if it fails.
    const localPreviewUrl = URL.createObjectURL(file);
    if (avatarEl) avatarEl.innerHTML = `<img class="avatar-photo" src="${localPreviewUrl}" alt="Profile photo">`;
    console.log('[avatar] local preview set');

    try {
        const dataUrl = await resizeImageToDataUrl(file);
        console.log('[avatar] resized, dataUrl length:', dataUrl.length);

        // ~1.37 bytes per base64 char; bail out rather than risk a Firestore
        // write failure if something unusually large slips through.
        if (dataUrl.length * 0.75 > 900 * 1024) {
            throw new Error('Resized image is still too large to save.');
        }

        const db = window.firebaseDb;
        const { doc, setDoc } = window.dbFns;
        console.log('[avatar] writing to Firestore, uid:', user.uid);
        await setDoc(doc(db, 'users', user.uid), { photo_url: dataUrl }, { merge: true });
        console.log('[avatar] Firestore write complete');

        if (avatarEl) avatarEl.innerHTML = `<img class="avatar-photo" src="${dataUrl}" alt="Profile photo">`;
        await window.renderAuthedNav?.(user); // updates the navbar avatar too
        console.log('[avatar] navbar refreshed, done');
        triggerToast('Profile photo updated.');
    } catch (err) {
        console.error('[avatar] FAILED:', err);
        triggerToast(err?.message || mapFirebaseError(err));
        if (avatarEl && previousHtml) avatarEl.innerHTML = previousHtml;
    } finally {
        URL.revokeObjectURL(localPreviewUrl);
    }
});

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
    async function renderAuthedNav(user) {
        const firstName = escapeHtml(await getFirstName(user));
        const photoUrl = await getAvatarPhotoUrl(user);
        const isAdmin = user.uid === ADMIN_UID;
        navMenu.innerHTML = `
            ${!isAdmin ? '<button id="navSupportBtn" class="btn-outline" title="Contact Support"><i class="fa-solid fa-headset"></i> Support</button>' : ''}
            <div class="notif-wrapper">
                <button id="chatBellBtn" class="notif-bell-btn" type="button" aria-label="Messages">
                    <i class="fa-solid fa-comment-dots"></i>
                    <span id="chatBadge" class="notif-badge" hidden>0</span>
                </button>
            </div>
            <div class="notif-wrapper">
                <button id="notifBellBtn" class="notif-bell-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Notifications">
                    <i class="fa-solid fa-bell"></i>
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
            <button id="navDashboardBtn" class="btn-outline" title="Back to Marketplace"><i class="fa-solid fa-shop"></i> Marketplace</button>
            <button id="navProfileBtn" class="nav-profile-pill" type="button" title="Your profile">
                ${avatarHtml(firstName || user.email || 'User', user.uid, photoUrl)}
                <span>Hi, ${firstName}</span>
            </button>
            <button id="navLogoutBtn" class="btn-outline"><i class="fa-solid fa-right-from-bracket"></i> Log Out</button>
        `;
        document.getElementById('navDashboardBtn').addEventListener('click', showDashboardView);
        document.getElementById('navProfileBtn').addEventListener('click', () => showProfileView(user));
        setupNotificationBell();
        document.getElementById('chatBellBtn').addEventListener('click', () => openMessagesModal());
        document.getElementById('navSupportBtn')?.addEventListener('click', () => {
            openOrCreateChat({ otherUid: ADMIN_UID, otherLabel: 'Support', type: 'support' });
        });
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
                    addListingBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Listing';
                } else {
                    addListingBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Sell Your Crop';
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

    // Blog posts are public marketing content, so load them regardless of
    // sign-in state (unlike crop listings, which only load once a user is
    // authenticated).
    loadBlogPosts();

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
