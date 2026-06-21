// --- 1. Supabase Initialization ---
// REPLACE THESE WITH YOUR ACTUAL PROJECT VALUES FROM SUPABASE DASHBOARD
const SUPABASE_URL = 'https://tmguwkueepgabbzsehdu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtZ3V3a3VlZXBnYWJienNlaGR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwMzMwNTgsImV4cCI6MjA5NzYwOTA1OH0.uNw6FAn9OmUAZVSKhBb8IgKsoEJkMWwN6_yFWzRTwPw';

const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1574943320219-553eb213f72d?auto=format&fit=crop&w=500&q=80";

// --- 2. View Management & Auth State ---
const landingPage = document.getElementById('landingPage');
const dashboardApp = document.getElementById('dashboardApp');
const navMenu = document.getElementById('navMenu');

async function checkAuthState() {
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
        landingPage.style.display = 'none';
        dashboardApp.style.display = 'block';

        navMenu.innerHTML = `
            <span class="nav-link"><i class="fa-solid fa-user-check"></i> Hello, User</span>
            <button id="navLogoutBtn" class="btn-outline"><i class="fa-solid fa-right-from-bracket"></i> Log Out</button>
        `;
        document.getElementById('navLogoutBtn').addEventListener('click', handleLogout);
        
        // Fetch real data from Supabase
        const { data: crops, error } = await supabase.from('crops').select('*');
        if (!error) renderListings(crops);
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

// --- 3. Static Page Logic (Kept as is) ---
const staticPages = {
    privacy: { title: "Privacy Policy", content: "<h3>Privacy Commitment</h3><p>We protect your data.</p>" },
    support: { title: "Support", content: "<h3>Need Help?</h3><p>Contact hassanconteh132@gmail.com</p>" },
    contact: { title: "Contact Us", content: "<h3>Contact Admin</h3><p>Phone: +232 76 786 944</p>" }
};

function showPage(pageKey) {
    document.getElementById('landingPage').style.display = 'none';
    document.getElementById('dashboardApp').style.display = 'none';
    document.getElementById('staticPageContainer').style.display = 'block';
    const page = staticPages[pageKey];
    document.getElementById('staticContent').innerHTML = `<h2>${page.title}</h2><div style="margin-top:1rem;">${page.content}</div>`;
}

function showDashboard() {
    document.getElementById('staticPageContainer').style.display = 'none';
    checkAuthState();
}

// --- 4. Authentication Processing (Supabase Auth) ---
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;

    const { error } = await supabase.auth.signUp({ email, password });
    if (error) triggerToast(error.message);
    else {
        authModal.classList.remove('active');
        triggerToast("Account created! Please check your email.");
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) triggerToast("Invalid email or password.");
    else {
        authModal.classList.remove('active');
        checkAuthState();
    }
});

// --- 5. Market Dashboard Logic (Supabase Query) ---
async function renderListings(listings) {
    const container = document.getElementById('cropCardsContainer');
    container.innerHTML = '';
    listings.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <img src="${item.image_url || FALLBACK_IMAGE}" class="card-img">
            <div class="card-content">
                <h3>${item.name}</h3>
                <span class="card-price">SLLE ${item.price}</span>
            </div>
        `;
        container.appendChild(card);
    });
}

async function applyFilters() {
    const searchTerm = document.getElementById('searchInput').value;
    const location = document.getElementById('locationFilter').value;

    let query = supabase.from('crops').select('*');
    if (searchTerm) query = query.ilike('name', `%${searchTerm}%`);
    if (location !== "All") query = query.eq('location', location);

    const { data } = await query;
    renderListings(data || []);
}

document.getElementById('searchBtn').addEventListener('click', applyFilters);
document.addEventListener('DOMContentLoaded', checkAuthState);
