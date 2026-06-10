// --- 1. Enhanced Mock Data ---
const mockData = [
    { 
        id: 1, 
        crop: "Premium Milled Rice", 
        category: "Grains",
        farmer: "Musa Kamara", 
        location: "Makeni", 
        price: "450", 
        unit: "50kg bag",
        image: "https://images.unsplash.com/photo-1586201375761-83865001e8ac?auto=format&fit=crop&w=500&q=80",
        date: "Today", 
        phone: "077xxxxxx" 
    },
    { 
        id: 2, 
        crop: "Fresh Cassava Tubers", 
        category: "Root Crop",
        farmer: "Fatmata Sesay", 
        location: "Bo", 
        price: "150", 
        unit: "dozen",
        image: "https://images.unsplash.com/photo-1596482161271-9b7e70417dd1?auto=format&fit=crop&w=500&q=80",
        date: "Yesterday", 
        phone: "076xxxxxx" 
    },
    { 
        id: 3, 
        crop: "Grade A Cocoa Beans", 
        category: "Export Crop",
        farmer: "Aminata Turay", 
        location: "Kenema", 
        price: "800", 
        unit: "bag",
        image: "https://images.unsplash.com/photo-1611079815049-58b8772a08c5?auto=format&fit=crop&w=500&q=80",
        date: "2 days ago", 
        phone: "079xxxxxx" 
    }
];

if (!localStorage.getItem('agriMarketData_v2')) {
    localStorage.setItem('agriMarketData_v2', JSON.stringify(mockData));
}

function getMarketListings() {
    return JSON.parse(localStorage.getItem('agriMarketData_v2')) || [];
}

// --- 2. DOM Rendering ---
const container = document.getElementById('cropCardsContainer');
const resultCount = document.getElementById('resultCount');

function renderListings(listings) {
    container.innerHTML = ''; 
    resultCount.innerText = `Showing ${listings.length} result(s)`;

    if (listings.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: #64748b;">
                <i class="fa-solid fa-basket-shopping" style="font-size: 3rem; margin-bottom: 1rem;"></i>
                <h3>No crops found</h3>
                <p>Try adjusting your search filters.</p>
            </div>`;
        return;
    }

    listings.forEach(item => {
        const card = document.createElement('div');
        card.className = 'card';

        // Format currency nicely
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
                <button class="btn-contact" onclick="triggerToast('Connecting to ${item.farmer} via SMS...')">
                    <i class="fa-regular fa-comment-dots"></i> Contact Farmer
                </button>
            </div>
        `;
        container.appendChild(card);
    });
}

// --- 3. Professional UI Notifications (Toast) ---
function triggerToast(message) {
    const toastBox = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #4ade80;"></i> ${message}`;
    
    toastBox.appendChild(toast);

    // Remove toast after 3 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- 4. Search and Filter Logic ---
document.getElementById('searchBtn').addEventListener('click', () => {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const locationFilter = document.getElementById('locationFilter').value;
    
    const allData = getMarketListings();
    
    const filteredData = allData.filter(item => {
        const matchesSearch = item.crop.toLowerCase().includes(searchTerm) || item.farmer.toLowerCase().includes(searchTerm);
        const matchesLocation = locationFilter === "All" || item.location === locationFilter;
        return matchesSearch && matchesLocation;
    });

    renderListings(filteredData);
});

// --- 5. Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    const initialData = getMarketListings();
    renderListings(initialData);
});
