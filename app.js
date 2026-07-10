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
        // crop name, farmer name, phone number, etc.).
        const name       = escapeHtml(item.name || 'Unnamed listing');
        const location   = escapeHtml(item.location || '');
        const category   = escapeHtml(item.category || '');
        const farmerName = escapeHtml(item.farmer_name || '');
        const phone      = escapeHtml(item.phone || '');
        const imageUrl   = escapeHtml(item.image_url || FALLBACK_IMAGE);

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
                <div class="card-meta">
                    ${farmerName ? `<p><i class="fa-solid fa-user"></i> ${farmerName}</p>` : ''}
                    ${phone ? `<p><i class="fa-solid fa-phone"></i> <a href="tel:${phone}">${phone}</a></p>` : ''}
                </div>
                ${phone ? `<button class="btn-contact" onclick="window.location.href='tel:${phone}'"><i class="fa-solid fa-phone"></i> Contact Farmer</button>` : ''}
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

// ===== Google Sign-In =====
// Shared handler for both the "Continue with Google" button on the Sign In
// tab and the one on the Create Account tab — Google auth doesn't
// distinguish between signing up and signing in, Firebase just creates the
// account on first use. On first sign-in we also create a 'users' profile
// doc, mirroring what the email/password registration flow writes, so
// getFirstName() and any other code that reads users/{uid} keeps working
// the same way regardless of which sign-in method someone used.
async function signInWithGoogleHandler(auth, db) {
    try {
        const { signInWithPopup } = window.authFns;
        const { doc, getDoc, setDoc } = window.dbFns;
        const provider = window.googleProvider;

        const result = await signInWithPopup(auth, provider);
        const user = result.user;

        try {
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

        landingPage.style.display = "none";
        dashboardApp.style.display = "block";
        await loadInitialCrops();
        closeModal();
    } catch (err) {
        // A user closing the Google popup shouldn't be logged as a hard
        // error — it's a normal, expected outcome.
        if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
            return;
        }
        console.error('Google sign-in failed', err);
        triggerToast(mapFirebaseError(err));
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
    const { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile } = window.authFns;
    const { collection, getDocs, doc, setDoc } = window.dbFns;

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
        if (user) {
            // User is signed in
            landingPage.style.display = 'none';
            dashboardApp.style.display = 'block';

            await renderAuthedNav(user);

            // Load initial crops and the notification bar for signed-in user
            await loadInitialCrops();
            loadNotifications();
        } else {
            // No user
            landingPage.style.display = 'block';
            dashboardApp.style.display = 'none';
            currentNotifications = [];
            readNotificationIdsCache = new Set();
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

    // Google Sign-In — same handler wired to both the Sign In tab's button
    // and the Create Account tab's button.
    document.getElementById('googleSignInBtn')?.addEventListener('click', () => signInWithGoogleHandler(auth, db));
    document.getElementById('googleSignUpBtn')?.addEventListener('click', () => signInWithGoogleHandler(auth, db));

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
