// --- 1. Database Initialization ---
const mockData = [
    { id: 1, crop: "Premium Country Rice", category: "Grains", farmer: "Musa Kamara", location: "Makeni", price: "450", unit: "50kg bag", image: "./images/rice.jpg", date: "Today", phone: "077xxxxxx" },
    { id: 2, crop: "Fresh Cassava Tubers", category: "Root Crop", farmer: "Fatmata Songa", location: "Bo", price: "150", unit: "dozen", image: "./images/cassava.jpg", date: "Yesterday", phone: "076xxxxxx" },
    { id: 3, crop: "Grade A Cocoa Beans", category: "Export Crop", farmer: "Aminata Kailondo", location: "Kenema", price: "800", unit: "bag", image: "./images/cocoa.jpg", date: "2 days ago", phone: "079xxxxxx" }
];

if (!localStorage.getItem('agriMarketData_v2')) localStorage.setItem('agriMarketData_v2', JSON.stringify(mockData));
if (!localStorage.getItem('agriUsers')) localStorage.setItem('agriUsers', JSON.stringify([]));

// --- 2. View Management ---
const landingPage = document.getElementById('landingPage');
const dashboardApp = document.getElementById('dashboardApp');
const staticPageContainer = document.getElementById('staticPageContainer');
const navMenu = document.getElementById('navMenu');

function checkAuthState() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    staticPageContainer.style.display = 'none';

    if (user) {
        landingPage.style.display = 'none';
        dashboardApp.style.display = 'block';
        navMenu.innerHTML = `
            <span class="nav-link"><i class="fa-solid fa-user-check"></i> Hello, ${user.name.split(' ')[0]}</span>
            <button id="navLogoutBtn" class="btn-outline"><i class="fa-solid fa-right-from-bracket"></i> Log Out</button>
        `;
        document.getElementById('navLogoutBtn').addEventListener('click', handleLogout);
        renderListings(JSON.parse(localStorage.getItem('agriMarketData_v2')));
    } else {
        landingPage.style.display = 'flex';
        dashboardApp.style.display = 'none';
        navMenu.innerHTML = `<button id="navLoginBtn" class="btn-outline">Log In</button>`;
        document.getElementById('navLoginBtn').addEventListener('click', () => openModal('login'));
    }
}

// --- 3. Static Pages Logic ---
const staticPages = {
    privacy: { title: "Privacy Policy", content: "<p>At AgriMarket SL, we value the trust of Sierra Leonean farmers. We collect only essential data to connect you with market opportunities.</p>" },
    support: { title: "Support", content: "<p>Contact admin at hassanconteh132@gmail.com for technical help.</p>" },
    contact: { title: "Contact Us", content: "<p><strong>Email:</strong> hassanconteh132@gmail.com<br><strong>Phone:</strong> +232 76 786 944</p>" }
};

function showPage(pageKey) {
    landingPage.style.display = 'none';
    dashboardApp.style.display = 'none';
    staticPageContainer.style.display = 'block';
    const page = staticPages[pageKey];
    document.getElementById('staticContent').innerHTML = `<h2>${page.title}</h2>${page.content}`;
}

function showDashboard() { checkAuthState(); }

document.querySelectorAll('.footer-links a').forEach((link, index) => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const pages = ['privacy', 'support', 'contact'];
        showPage(pages[index]);
    });
});

// --- 4. Modals & Auth ---
const authModal = document.getElementById('authModal');
function openModal(mode) {
    authModal.classList.add('active');
    document.getElementById('authTabsContainer').style.display = 'flex';
    document.getElementById('resetForm').classList.remove('active');
    mode === 'register' ? document.getElementById('tabRegister').click() : document.getElementById('tabLogin').click();
}

document.getElementById('btnStartLogin').addEventListener('click', () => openModal('login'));
document.getElementById('btnStartRegister').addEventListener('click', () => openModal('register'));
document.getElementById('closeModal').addEventListener('click', () => authModal.classList.remove('active'));

// --- 5. Market Listings ---
function renderListings(listings) {
    const container = document.getElementById('cropCardsContainer');
    container.innerHTML = ''; 
    document.getElementById('resultCount').innerText = `${listings.length} active listing(s)`;

    listings.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'card float-in';
        card.style.animationDelay = `${index * 0.1}s`;
        card.innerHTML = `
            <img src="${item.image}" alt="${item.crop}" class="card-img">
            <div class="card-content">
                <div class="badge-row"><span class="badge badge-category">${item.category}</span><span class="badge badge-location">${item.location}</span></div>
                <h3 class="card-title">${item.crop}</h3>
                <span class="card-price">NLE ${item.price} / ${item.unit}</span>
                <div class="card-meta" style="margin-top:1rem; border-top:1px solid #e2e8f0; padding-top:0.8rem;">
                    <p><strong>Farmer:</strong> ${item.farmer}</p>
                    <p><strong>Phone:</strong> <a href="tel:${item.phone}">${item.phone}</a></p>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

document.getElementById('searchBtn').addEventListener('click', () => {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const locationFilter = document.getElementById('locationFilter').value;
    const data = JSON.parse(localStorage.getItem('agriMarketData_v2'));
    renderListings(data.filter(item => (item.crop.toLowerCase().includes(searchTerm)) && (locationFilter === "All" || item.location === locationFilter)));
});

function handleLogout() { localStorage.removeItem('currentUser'); checkAuthState(); }
function triggerToast(message) { /* Add your existing toast logic here */ }
document.addEventListener('DOMContentLoaded', checkAuthState);
