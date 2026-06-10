// --- 1. Mock Data Setup (Simulating a Database) ---
const mockData = [
    { id: 1, crop: "Milled Rice", farmer: "Musa Kamara", location: "Makeni", price: "NLE 450 / 50kg bag", date: "2026-06-08", phone: "077xxxxxx" },
    { id: 2, crop: "Cassava Tubers", farmer: "Fatmata Sesay", location: "Bo", price: "NLE 150 / dozen", date: "2026-06-07", phone: "076xxxxxx" },
    { id: 3, crop: "Palm Oil", farmer: "Ibrahim Bah", location: "Kenema", price: "NLE 300 / 5 gallons", date: "2026-06-08", phone: "078xxxxxx" },
    { id: 4, crop: "Cocoa Beans", farmer: "Aminata Turay", location: "Kenema", price: "NLE 800 / bag", date: "2026-06-05", phone: "079xxxxxx" }
];

// Initialize LocalStorage if empty
if (!localStorage.getItem('agriMarketData')) {
    localStorage.setItem('agriMarketData', JSON.stringify(mockData));
}

// --- 2. Data Retrieval ---
// Fetch data from local storage
function getMarketListings() {
    return JSON.parse(localStorage.getItem('agriMarketData')) || [];
}

// --- 3. DOM Rendering ---
const container = document.getElementById('cropCardsContainer');

function renderListings(listings) {
    container.innerHTML = ''; // Clear current listings

    if (listings.length === 0) {
        container.innerHTML = '<p>No crops found matching your criteria.</p>';
        return;
    }

    listings.forEach(item => {
        // Create card element
        const card = document.createElement('div');
        card.className = 'card';

        // Populate card HTML
        card.innerHTML = `
            <div class="card-header">
                <h3 class="card-title">${item.crop}</h3>
                <span class="card-price">${item.price}</span>
            </div>
            <div class="card-details">
                <p>📍 <strong>Location:</strong> ${item.location}</p>
                <p>👨🏾‍🌾 <strong>Farmer:</strong> ${item.farmer}</p>
                <p>📅 <strong>Listed:</strong> ${item.date}</p>
            </div>
            <button class="btn-contact" onclick="contactFarmer('${item.phone}')">Contact via Chat/SMS</button>
        `;
        container.appendChild(card);
    });
}

// Dummy function for the contact button
function contactFarmer(phone) {
    alert(`Initiating chat/SMS integration (Twilio/AfricasTalking) for: ${phone}`);
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

// --- 5. Initial Render on Page Load ---
document.addEventListener('DOMContentLoaded', () => {
    const initialData = getMarketListings();
    renderListings(initialData);
});
