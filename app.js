// --- 1. Database Initialization ---
const mockData = [
    { id: 1, crop: "Premium Milled Rice", category: "Grains", farmer: "Musa Kamara", location: "Makeni", price: "450", unit: "50kg bag", image: "https://images.unsplash.com/photo-1586201375761-83865001e8ac?auto=format&fit=crop&w=500&q=80", date: "Today", phone: "077xxxxxx" },
    { id: 2, crop: "Fresh Cassava Tubers", category: "Root Crop", farmer: "Fatmata Sesay", location: "Bo", price: "150", unit: "dozen", image: "https://images.unsplash.com/photo-1596482161271-9b7e70417dd1?auto=format&fit=crop&w=500&q=80", date: "Yesterday", phone: "076xxxxxx" },
    { id: 3, crop: "Grade A Cocoa Beans", category: "Export Crop", farmer: "Aminata Turay", location: "Kenema", price: "800", unit: "bag", image: "https://github.com/Hassanconteh/AgriMarket-SL-Farmer-to-Market-Platform/blob/main/images/Sierra%20Leone%20Cocoa%20woman.jfif", date: "2 days ago", phone: "079xxxxxx" }
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

// --- 5. Market Dashboard Logic ---
const container = document.getElementById('cropCardsContainer');
const resultCount = document.getElementById('resultCount');

function renderListings(listings) {
    container.innerHTML = ''; 
    resultCount.innerText = `${listings.length} active listing(s)`;

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
                <button class="btn-contact" onclick="triggerToast('Opening chat with ${item.farmer}...')">
                    <i class="fa-regular fa-comment-dots"></i> Message Farmer
                </button>
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
