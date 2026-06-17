// --- 1. Database Initialization ---
const mockData = [
    { id: 1, crop: "Premium Country Rice", category: "Grains", farmer: "Musa Kamara", location: "Makeni", price: "450", unit: "50kg bag", image: "./images/rice.jpg", date: "Today", phone: "077xxxxxx" },
    { id: 2, crop: "Fresh Cassava Tubers", category: "Root Crop", farmer: "Fatmata Songa", location: "Bo", price: "150", unit: "dozen", image: "./images/cassava.jpg", date: "Yesterday", phone: "076xxxxxx" },
    { id: 3, crop: "Grade A Cocoa Beans", category: "Export Crop", farmer: "Aminata Kailondo", location: "Kenema", price: "800", unit: "bag", image: "./images/cocoa.jpg", date: "2 days ago", phone: "079xxxxxx" }
];

if (!localStorage.getItem('agriMarketData_v2')) localStorage.setItem('agriMarketData_v2', JSON.stringify(mockData));
if (!localStorage.getItem('agriUsers')) localStorage.setItem('agriUsers', JSON.stringify([]));


// --- 2. View Management (The "Auth Gate") ---
const landingPage = document.getElementById('landingPage');
const dashboardApp = document.getElementById('dashboardApp');
const navMenu = document.getElementById('navMenu');

function checkAuthState() {
    const user = JSON.parse(localStorage.getItem('currentUser'));

    if (user) {
        // User IS logged in: Show Dashboard, Hide Landing
        landingPage.style.display = 'none';
        dashboardApp.style.display = 'block';
        
        // Populate Navigation for Logged-in User
        navMenu.innerHTML = `
            <span class="nav-link"><i class="fa-solid fa-user-check"></i> Hello, ${user.name.split(' ')[0]}</span>
            <button id="navLogoutBtn" class="btn-outline"><i class="fa-solid fa-right-from-bracket"></i> Log Out</button>
        `;
        
        // Attach logout listener
        document.getElementById('navLogoutBtn').addEventListener('click', handleLogout);
        
        // Render data
        renderListings(JSON.parse(localStorage.getItem('agriMarketData_v2')));
    } else {
        // User IS NOT logged in: Show Landing, Hide Dashboard
        landingPage.style.display = 'flex';
        dashboardApp.style.display = 'none';
        
        // Populate Navigation for Guest
        navMenu.innerHTML = `
            <button id="navLoginBtn" class="btn-outline">Log In</button>
        `;
        document.getElementById('navLoginBtn').addEventListener('click', () => openModal('login'));
    }
}

function handleLogout() {
    localStorage.removeItem('currentUser');
    triggerToast("You have been securely logged out.");
    checkAuthState(); // Refresh view back to landing page
}

// --- New: Static Page Content ---
const staticPages = {
    privacy: {
        title: "Privacy Policy",
        content: `<h3>Our Commitment to Your Privacy</h3>
                  <p>At AgriMarket SL, we value the trust of Sierra Leonean farmers. We collect only essential data to connect you with market opportunities. We do not sell your personal information to third parties.</p>`
    },
    support: {
        title: "Support",
        content: `<h3>Need Help?</h3>
                  <p>Our team is here to assist you with account access, navigation, or marketplace listings. Please reach out to the site administrator at hassanconteh132@gmail.com if you encounter any technical issues while using the platform.</p>`
    },
    contact: {
        title: "Contact Us",
        content: `<h3>Contact Site Admin</h3>
                  <p>For official inquiries or partnership opportunities:</p>
                  <p><strong>Email:</strong> hassanconteh132@gmail.com<br>
                  <strong>Phone:</strong> +232 76 786 944<br>
                  <strong>WhatsApp:</strong> +232 76 786 944<br>
                  <strong>Office:</strong> Kenema, Sierra Leone</p>`
    }
};

function showPage(pageKey) {
    const staticContainer = document.getElementById('staticPageContainer');
    const staticContent = document.getElementById('staticContent');
    const page = staticPages[pageKey];
    
    // Hide everything else
    document.getElementById('landingPage').style.display = 'none';
    document.getElementById('dashboardApp').style.display = 'none';
    
    // Show static container and inject content
    staticContainer.style.display = 'block';
    staticContent.innerHTML = `<h2>${page.title}</h2><div style="margin-top:1rem;">${page.content}</div>`;
}

function showDashboard() {
    document.getElementById('staticPageContainer').style.display = 'none';
    checkAuthState(); // Re-runs your existing check
}

// Attach these to your Footer Links
document.querySelectorAll('.footer-links a').forEach((link, index) => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const pages = ['privacy', 'support', 'contact'];
        showPage(pages[index]);
    });
});

// --- 3. Modal & Tab Logic ---
const authModal = document.getElementById('authModal');
const authTabsContainer = document.getElementById('authTabsContainer');
const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const resetForm = document.getElementById('resetForm');

function openModal(mode) {
    authModal.classList.add('active');
    authTabsContainer.style.display = 'flex'; // Ensure tabs are visible
    resetForm.classList.remove('active'); // Ensure reset form is hidden
    
    if (mode === 'register') {
        tabRegister.click();
    } else {
        tabLogin.click();
    }
}

document.getElementById('btnStartLogin').addEventListener('click', () => openModal('login'));
document.getElementById('btnStartRegister').addEventListener('click', () => openModal('register'));
document.getElementById('closeModal').addEventListener('click', () => authModal.classList.remove('active'));

// Standard Tabs
tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active'); tabRegister.classList.remove('active');
    loginForm.classList.add('active'); registerForm.classList.remove('active');
});

tabRegister.addEventListener('click', () => {
    tabRegister.classList.add('active'); tabLogin.classList.remove('active');
    registerForm.classList.add('active'); loginForm.classList.remove('active');
});

// Password Reset Navigation
document.getElementById('forgotPasswordLink').addEventListener('click', (e) => {
    e.preventDefault();
    authTabsContainer.style.display = 'none'; // Hide top tabs
    loginForm.classList.remove('active');
    resetForm.classList.add('active'); // Show reset form
});

document.getElementById('backToLoginLink').addEventListener('click', (e) => {
    e.preventDefault();
    resetForm.classList.remove('active');
    authTabsContainer.style.display = 'flex'; // Bring back top tabs
    loginForm.classList.add('active');
});


// --- 4. Authentication Processing ---
registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    const users = JSON.parse(localStorage.getItem('agriUsers'));

    if (users.find(u => u.email === email)) {
        triggerToast("Email already exists. Try logging in."); return;
    }

    const newUser = { name, email, password };
    users.push(newUser);
    localStorage.setItem('agriUsers', JSON.stringify(users));
    localStorage.setItem('currentUser', JSON.stringify(newUser)); 
    
    authModal.classList.remove('active');
    registerForm.reset();
    triggerToast(`Account created! Welcome to AgriMarket SL.`);
    checkAuthState(); 
});

loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const users = JSON.parse(localStorage.getItem('agriUsers'));
    const user = users.find(u => u.email === email && u.password === password);

    if (user) {
        localStorage.setItem('currentUser', JSON.stringify(user));
        authModal.classList.remove('active');
        loginForm.reset();
        triggerToast(`Welcome back, ${user.name}!`);
        checkAuthState(); 
    } else {
        triggerToast("Invalid email or password.");
    }
});

// Password Reset Processing
resetForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('resetEmail').value;
    const newPassword = document.getElementById('newPassword').value;
    
    const users = JSON.parse(localStorage.getItem('agriUsers'));
    const userIndex = users.findIndex(u => u.email === email);

    if (userIndex !== -1) {
        // User found: Update their password in the array
        users[userIndex].password = newPassword;
        localStorage.setItem('agriUsers', JSON.stringify(users));
        
        triggerToast("Password successfully reset! Please log in.");
        
        // Reset the UI back to login mode
        resetForm.reset();
        resetForm.classList.remove('active');
        authTabsContainer.style.display = 'flex';
        loginForm.classList.add('active');
        
        // Convenience: Pre-fill the login email for them
        document.getElementById('loginEmail').value = email;
    } else {
        triggerToast("Account with this email not found. Please check spelling.");
    }
});

// --- 5. Market Dashboard Logic (Updated) ---
const container = document.getElementById('cropCardsContainer');
// Note: Ensure you have an element with id="resultCount" in your index.html
const resultCount = document.getElementById('resultCount'); 

function renderListings(listings) {
    container.innerHTML = ''; 
    if(resultCount) resultCount.innerText = `${listings.length} active listing(s)`;

    listings.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'card float-in'; 
        card.style.animationDelay = `${index * 0.1}s`; 
        
        card.innerHTML = `
            <img src="${item.image}" alt="${item.crop}" class="card-img">
            <div class="card-content">
                <div class="badge-row">
                    <span class="badge badge-category">${item.category}</span>
                    <span class="badge badge-location"><i class="fa-solid fa-map-pin"></i> ${item.location}</span>
                </div>
                <h3 class="card-title">${item.crop}</h3>
                <span class="card-price">NLE ${item.price} <span style="font-size:0.9rem; color:#64748b;">/ ${item.unit}</span></span>
                
                <!-- Added Contact & Info Section -->
                <div class="card-meta" style="margin-top:1rem; font-size:0.85rem; color:#475569; border-top: 1px solid #e2e8f0; padding-top:0.8rem;">
                    <p style="margin-bottom:0.3rem;"><strong>Farmer:</strong> ${item.farmer}</p>
                    <p style="margin-bottom:0.3rem;"><strong>Phone:</strong> <a href="tel:${item.phone}">${item.phone}</a></p>
                    <p style="margin-bottom:0.3rem;"><strong>Posted:</strong> ${item.date}</p>
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
    
    const filtered = data.filter(item => {
        const matchesSearch = item.crop.toLowerCase().includes(searchTerm);
        const matchesLocation = locationFilter === "All" || item.location === locationFilter;
        return matchesSearch && matchesLocation;
    });
    renderListings(filtered);
});

// Helper: UI Notifications
function triggerToast(message) {
    const toastBox = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i class="fa-solid fa-circle-info" style="color: #4ade80; margin-right:8px;"></i> ${message}`;
    toastBox.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- 6. Initialize App on Load ---
document.addEventListener('DOMContentLoaded', checkAuthState);
