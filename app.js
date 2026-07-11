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

const pendingApprovalsSection   = document.getElementById('pendingApprovalsSection');
const pendingApprovalsContainer = document.getElementById('pendingApprovalsContainer');
const pendingApprovalsCount     = document.getElementById('pendingApprovalsCount');

const mySubmissionsSection   = document.getElementById('mySubmissionsSection');
const mySubmissionsContainer = document.getElementById('mySubmissionsContainer');

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
            </div>
        `;
        if (item.id) {
            card.querySelector('.btn-contact')?.addEventListener('click', (e) => {
                e.preventDefault();
                handleContactFarmerClick(item.id);
            });
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

    // onAuthStateChanged (registered in initApp) already handles showing
    // the dashboard and rendering the navbar once the auth state resolves,
    // so this just adds a welcome toast on top.
    const firstName = user.displayName ? user.displayName.trim().split(/\s+/)[0] : '';
    triggerToast(firstName ? `Welcome, ${firstName}!` : 'Signed in with Google.');
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
                <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
                    <button type="button" class="btn-approve" data-id="${item.id}">Approve</button>
                    <button type="button" class="btn-reject" data-id="${item.id}">Reject</button>
                </div>
            </div>
        `;
        card.querySelector('.btn-approve').addEventListener('click', () => handleReviewListing(item.id, 'approved'));
        card.querySelector('.btn-reject').addEventListener('click', () => handleReviewListing(item.id, 'rejected'));
        pendingApprovalsContainer.appendChild(card);
    });
}

async function handleReviewListing(cropId, newStatus) {
    const db = window.firebaseDb;
    const { doc, setDoc } = window.dbFns;
    try {
        // setDoc with merge:true only touches the 'status' field, leaving
        // the rest of the listing (and the separate private/contact doc)
        // untouched — matches the Firestore rule, which only allows the
        // admin to update 'crops' docs, not farmers editing their own after
        // submission.
        await setDoc(doc(db, 'crops', cropId), { status: newStatus }, { merge: true });
        triggerToast(newStatus === 'approved' ? 'Listing approved and now live.' : 'Listing rejected.');
        await loadPendingApprovals();
        if (newStatus === 'approved') await loadInitialCrops();
    } catch (err) {
        console.error('Failed to update listing status', err);
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
            </div>
        `;
        mySubmissionsContainer.appendChild(card);
    });
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
        navMenu.innerHTML = `
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
            <span class="nav-link"><i class="fa-solid fa-user-check"></i> Hi, ${firstName}</span>
            <button id="navLogoutBtn" class="btn-outline"><i class="fa-solid fa-right-from-bracket"></i> Log Out</button>
        `;
        document.getElementById('navDashboardBtn').addEventListener('click', showDashboardView);
        setupNotificationBell();
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

            // (Re)start the inactivity clock now that someone is signed in.
            resetInactivityTimer();
        } else {
            // No user
            landingPage.style.display = 'block';
            dashboardApp.style.display = 'none';
            if (addListingBtn) addListingBtn.hidden = true;
            if (pendingApprovalsSection) pendingApprovalsSection.hidden = true;
            if (mySubmissionsSection) mySubmissionsSection.hidden = true;
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

            closeModal();
            triggerToast("Account created! We've sent a verification link to your email — you'll need to verify it before contacting farmers.");
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

    // Google Sign-In — same handler wired to both the Sign In tab's button
    // and the Create Account tab's button. This navigates away from the
    // page immediately (redirect flow), so there's no modal-closing logic
    // to run here — the user comes right back to this page once signed in.
    document.getElementById('googleSignInBtn')?.addEventListener('click', () => signInWithGoogleHandler(auth));
    document.getElementById('googleSignUpBtn')?.addEventListener('click', () => signInWithGoogleHandler(auth));

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
