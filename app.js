// --- 1. Mock Data Integration ---
const mockData = [
    { id: 1, crop: "Premium Milled Rice", category: "Grains", farmer: "Musa Kamara", location: "Makeni", price: "450", unit: "50kg bag", image: "https://images.unsplash.com/photo-1586201375761-83865001e8ac?auto=format&fit=crop&w=500&q=80", date: "Today", phone: "077xxxxxx" },
    { id: 2, crop: "Fresh Cassava Tubers", category: "Root Crop", farmer: "Fatmata Sesay", location: "Bo", price: "150", unit: "dozen", image: "https://images.unsplash.com/photo-1596482161271-9b7e70417dd1?auto=format&fit=crop&w=500&q=80", date: "Yesterday", phone: "076xxxxxx" },
    { id: 3, crop: "Grade A Cocoa Beans", category: "Export Crop", farmer: "Aminata Turay", location: "Kenema", price: "800", unit: "bag", image: "https://images.unsplash.com/photo-1611079815049-58b8772a08c5?auto=format&fit=crop&w=500&q=80", date: "2 days ago", phone: "079xxxxxx" }
];

if (!localStorage.getItem('agriMarketData_v2')) {
    localStorage.setItem('agriMarketData_v2', JSON.stringify(mockData));
}

// Ensure user database array exists
if (!localStorage.getItem('agriUsers')) {
    localStorage.setItem('agriUsers', JSON.stringify([]));
}

// --- 2. Auth Modal Logic ---
const authModal = document.getElementById('authModal');
const navLoginBtn = document.getElementById('navLoginBtn');
const closeModalBtn = document.getElementById('closeModal');
const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

// Open/Close Modal
navLoginBtn.addEventListener('click', () => {
    // If user is already logged in, this button acts as a Logout
    if (localStorage.getItem('currentUser')) {
        localStorage.removeItem('currentUser');
        triggerToast("You have been logged out.");
        updateNavState();
    } else {
        authModal.classList.add('active');
    }
});

closeModalBtn.addEventListener('click', () => authModal.classList.remove('active'));

// Switch Tabs
tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    loginForm.classList.add('active');
    registerForm.classList.remove('active');
});

tabRegister.addEventListener('click', () => {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    registerForm.classList.add('active');
    loginForm.classList.remove('active');
});

// --- 3. Authentication System ---

// Register User
registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;

    const users = JSON.parse(localStorage.getItem('agriUsers'));

    // Check if email exists
    if (users.find(u => u.email === email)) {
        triggerToast("Email is already registered. Please log in.");
        return;
    }

    // Save user
    const newUser = { name, email, password };
    users.push(newUser);
    localStorage.setItem('agriUsers', JSON.stringify(users));
    
    // Auto login
    localStorage.setItem('currentUser', JSON.stringify(newUser));
    triggerToast(`Account created! Welcome, ${name}.`);
    authModal.classList.remove('active');
    updateNavState();
    registerForm.reset();
});

// Login User
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    const users = JSON.parse(localStorage.getItem('agriUsers'));
    const user = users.find(u => u.email === email && u.password === password);

    if (user) {
        localStorage.setItem('currentUser', JSON.stringify(user));
        triggerToast(`Welcome back, ${user.name}!`);
        authModal.classList.remove('active');
        updateNavState();
        loginForm.reset();
    } else {
        triggerToast("Invalid email or password.");
    }
});

// Update Navbar based on Auth State
function updateNavState() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (user) {
        navLoginBtn.innerText = "Log Out";
        navLoginBtn.style.color = "var(--sl-green)";
        navLoginBtn.style.borderColor = "var(--sl-green)";
        navLoginBtn.innerHTML = `<i class="fa-regular fa-user"></i> ${user.name.split(' ')[0]} (Logout)`;
    } else {
        navLoginBtn.innerText = "Log In";
        navLoginBtn.style.color = "var(--sl-blue)";
        navLoginBtn.style.borderColor = "var(--sl-blue)";
    }
}

// --- 4. Core Render Functions ---
function getMarketListings() {
    return JSON.parse(localStorage.getItem('agriMarketData_v2')) || [];
}

const container = document.getElementById('cropCardsContainer');
const resultCount = document.getElementById('resultCount');

function renderListings(listings) {
    container.innerHTML = ''; 
    resultCount.innerText = `Showing ${listings.length} result(s)`;

    listings.forEach(item => {
        const card = document.createElement('div');
        card.className = 'card float-in'; // Apply float-in to cards too
        card.style.animationDelay = `${item.id * 0.1}s`; // Staggered animation
        
        const formattedPrice = `NLE ${item.price} <span style="font-size:0.9rem; color:#64748b; font-weight:400;">/ ${item.unit}</span>`;

        card.innerHTML = `
            <img src="${item.image}" alt="${item.crop}" class="card-img">
            <div class="card-content">
                <div class="badge-row">
                    <span class="badge badge-category">${item.category}</span>
                    <span class="badge badge-location"><i class="fa-solid fa-map-pin"></i> ${item.location}</span>
                </div>
                <h3 class="card-title">${item.crop}</h3>
                <span class="card-price">${formattedPrice}</span>
                <div class="card-details">
                    <p><i class="fa-regular fa-user"></i> ${item.farmer}</p>
                    <p><i class="fa-regular fa-clock"></i> Listed ${item.date}</p>
                </div>
                <button class="btn-contact" onclick="handleContact('${item.farmer}')">
                    <i class="fa-regular fa-comment-dots"></i> Contact Farmer
                </button>
            </div>
        `;
        container.appendChild(card);
    });
}

function handleContact(farmerName) {
    if (!localStorage.getItem('currentUser')) {
        triggerToast("Please log in to contact farmers.");
        authModal.classList.add('active');
        return;
    }
    triggerToast(`Connecting to ${farmerName} via secure SMS...`);
}

function triggerToast(message) {
    const toastBox = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = message;
    
    toastBox.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Search Logic
document.getElementById('searchBtn').addEventListener('click', () => {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const locationFilter = document.getElementById('locationFilter').value;
    
    const filteredData = getMarketListings().filter(item => {
        const matchesSearch = item.crop.toLowerCase().includes(searchTerm) || item.farmer.toLowerCase().includes(searchTerm);
        const matchesLocation = locationFilter === "All" || item.location === locationFilter;
        return matchesSearch && matchesLocation;
    });

    renderListings(filteredData);
});

// Init
document.addEventListener('DOMContentLoaded', () => {
    updateNavState();
    renderListings(getMarketListings());
});
