const SUPABASE_URL = 'https://tmguwkueepgabbzsehdu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtZ3V3a3VlZXBnYWJienNlaGR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwMzMwNTgsImV4cCI6MjA5NzYwOTA1OH0.uNw6FAn9OmUAZVSKhBb8IgKsoEJkMWwN6_yFWzRTwPw';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1574943320219-553eb213f72d?auto=format&fit=crop&w=500&q=80";

const landingPage   = document.getElementById('landingPage');
const dashboardApp  = document.getElementById('dashboardApp');
const navMenu       = document.getElementById('navMenu');
const authModal     = document.getElementById('authModal');
const loginForm     = document.getElementById('loginForm');
const registerForm  = document.getElementById('registerForm');
const resetForm     = document.getElementById('resetForm');

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

function hideAuthTabs() {
    document.getElementById('authTabsContainer').style.display = 'none';
}

function showAuthTabs() {
    document.getElementById('authTabsContainer').style.display = 'flex';
}

async function checkAuthState() {
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
        landingPage.style.display = 'none';
        dashboardApp.style.display = 'block';

        navMenu.innerHTML = `
            <span class="nav-link"><i class="fa-solid fa-user-check"></i> ${user.email}</span>
            <button id="navLogoutBtn" class="btn-outline"><i class="fa-solid fa-right-from-bracket"></i> Log Out</button>
        `;
        document.getElementById('navLogoutBtn').addEventListener('click', handleLogout);

        const { data: crops, error } = await supabase.from('crops').select('*');
        if (!error) renderListings(crops || []);
    } else {
        landingPage.style.display = 'flex';
        dashboardApp.style.display = 'none';
        navMenu.innerHTML = `<button id="navLoginBtn" class="btn-outline">Log In</button>`;
        document.getElementById('navLoginBtn').addEventListener('click', () => openModal('login'));
    }
}

async function handleLogout() {
    await supabase.auth.signOut();
    triggerToast("You have been securely logged out.");
    checkAuthState();
}

const staticPages = {
    privacy: { title: "Privacy Policy", content: "<h3>Privacy Commitment</h3><p>We protect your data.</p>" },
    support: { title: "Support",        content: "<h3>Need Help?</h3><p>Contact hassanconteh132@gmail.com</p>" },
    contact: { title: "Contact Us",     content: "<h3>Contact Admin</h3><p>Phone: +232 76 786 944</p>" }
};

function showPage(pageKey) {
    document.getElementById('landingPage').style.display        = 'none';
    document.getElementById('dashboardApp').style.display       = 'none';
    document.getElementById('staticPageContainer').style.display = 'block';
    const page = staticPages[pageKey];
    document.getElementById('staticContent').innerHTML = `<h2>${page.title}</h2><div style="margin-top:1rem;">${page.content}</div>`;
}

function showDashboard() {
    document.getElementById('staticPageContainer').style.display = 'none';
    checkAuthState();
}

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name     = document.getElementById('regName').value;
    const email    = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;

    const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
    if (error) triggerToast(error.message);
    else {
        closeModal();
        triggerToast("Account created! Please check your email to confirm.");
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) triggerToast("Invalid email or password.");
    else {
        closeModal();
        checkAuthState();
    }
});

resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email       = document.getElementById('resetEmail').value;
    const newPassword = document.getElementById('newPassword').value;

    const { error } = await supabase.auth.updateUser({ email, password: newPassword });
    if (error) triggerToast(error.message);
    else {
        triggerToast("Password updated successfully. Please sign in.");
        showAuthTabs();
        switchTab('login');
    }
});

async function renderListings(listings) {
    const container   = document.getElementById('cropCardsContainer');
    const resultCount = document.getElementById('resultCount');
    container.innerHTML = '';

    if (listings.length === 0) {
        container.innerHTML = '<p class="text-muted" style="grid-column:1/-1;padding:2rem 0;">No listings found for your search.</p>';
        resultCount.textContent = '0 listings';
        return;
    }

    resultCount.textContent = `${listings.length} listing${listings.length !== 1 ? 's' : ''}`;

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
                <span class="card-price">SLLE ${Number(item.price).toLocaleString()}</span>
                <div class="card-meta">
                    ${item.farmer_name ? `<p><i class="fa-solid fa-user"></i> ${item.farmer_name}</p>` : ''}
                    ${item.phone ? `<p><i class="fa-solid fa-phone"></i> <a href="tel:${item.phone}">${item.phone}</a></p>` : ''}
                </div>
                ${item.phone ? `<button class="btn-contact" onclick="window.location.href='tel:${item.phone}'"><i class="fa-solid fa-phone"></i> Contact Farmer</button>` : ''}
            </div>
        `;
        container.appendChild(card);
    });
}

async function applyFilters() {
    const searchTerm = document.getElementById('searchInput').value.trim();
    const location   = document.getElementById('locationFilter').value;

    let query = supabase.from('crops').select('*');
    if (searchTerm)         query = query.ilike('name', `%${searchTerm}%`);
    if (location !== 'All') query = query.eq('location', location);

    const { data, error } = await query;
    if (!error) renderListings(data || []);
}

document.getElementById('searchBtn').addEventListener('click', applyFilters);

document.getElementById('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyFilters();
});

document.getElementById('closeModal').addEventListener('click', closeModal);

authModal.addEventListener('click', (e) => {
    if (e.target === authModal) closeModal();
});

document.getElementById('tabLogin').addEventListener('click', () => {
    showAuthTabs();
    switchTab('login');
});

document.getElementById('tabRegister').addEventListener('click', () => {
    showAuthTabs();
    switchTab('register');
});

document.getElementById('forgotPasswordLink').addEventListener('click', (e) => {
    e.preventDefault();
    hideAuthTabs();
    switchTab('reset');
});

document.getElementById('backToLoginLink').addEventListener('click', (e) => {
    e.preventDefault();
    showAuthTabs();
    switchTab('login');
});

document.getElementById('btnStartLogin').addEventListener('click', () => openModal('login'));
document.getElementById('btnStartRegister').addEventListener('click', () => openModal('register'));

document.addEventListener('DOMContentLoaded', checkAuthState);
