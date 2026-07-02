#!/usr/bin/env node

/**
 * Firestore Migration Script: Populate sample crops data
 * 
 * Run this script to populate the Firestore 'crops' collection with sample data.
 * 
 * Prerequisites:
 * - Install dependencies: npm install firebase-admin
 * - Download your Firebase service account key from Firebase Console > Project Settings > Service Accounts
 * - Set the path to the service account key in the FIREBASE_KEY_PATH variable below
 * 
 * Usage:
 *   node populate-crops.js
 */

const admin = require('firebase-admin');
const path = require('path');

// ============ CONFIGURATION ============
// Update this path to point to your Firebase service account key JSON file
// Download it from: Firebase Console > Project Settings > Service Accounts > Generate New Private Key
const FIREBASE_KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');

const FIREBASE_PROJECT_ID = 'agrimarket-sl'; // Your Firebase project ID

// ============ SAMPLE CROPS DATA ============
const SAMPLE_CROPS = [
  {
    name: 'Rice - Grade A',
    name_lower: 'rice - grade a',
    price: 85000,
    location: 'Bo',
    category: 'Grains',
    farmer_name: 'Ibrahim Koroma',
    phone: '+232 76 123 4567',
    image_url: 'https://images.unsplash.com/photo-1586985289688-cacf0602b02f?auto=format&fit=crop&w=500&q=80',
    created_at: new Date().toISOString()
  },
  {
    name: 'Cocoa Beans',
    name_lower: 'cocoa beans',
    price: 125000,
    location: 'Kenema',
    category: 'Cash Crops',
    farmer_name: 'Amara Sesay',
    phone: '+232 78 987 6543',
    image_url: 'https://images.unsplash.com/photo-1599599810694-b5ac4dd37b1b?auto=format&fit=crop&w=500&q=80',
    created_at: new Date().toISOString()
  },
  {
    name: 'Cassava',
    name_lower: 'cassava',
    price: 45000,
    location: 'Makeni',
    category: 'Root Crops',
    farmer_name: 'Musu Jalloh',
    phone: '+232 76 555 8888',
    image_url: 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=500&q=80',
    created_at: new Date().toISOString()
  },
  {
    name: 'Ginger',
    name_lower: 'ginger',
    price: 95000,
    location: 'Western Area',
    category: 'Spices',
    farmer_name: 'Hassan Conteh',
    phone: '+232 76 786 944',
    image_url: 'https://images.unsplash.com/photo-1596040436074-ca7ddb89f519?auto=format&fit=crop&w=500&q=80',
    created_at: new Date().toISOString()
  },
  {
    name: 'Peanuts',
    name_lower: 'peanuts',
    price: 65000,
    location: 'Bo',
    category: 'Legumes',
    farmer_name: 'Fatou Bangura',
    phone: '+232 78 444 2222',
    image_url: 'https://images.unsplash.com/photo-1585707371407-97dbf01acd25?auto=format&fit=crop&w=500&q=80',
    created_at: new Date().toISOString()
  },
  {
    name: 'Kale',
    name_lower: 'kale',
    price: 35000,
    location: 'Kenema',
    category: 'Vegetables',
    farmer_name: 'Mariama Diallo',
    phone: '+232 79 111 3333',
    image_url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=500&q=80',
    created_at: new Date().toISOString()
  },
  {
    name: 'Peppers - Red',
    name_lower: 'peppers - red',
    price: 55000,
    location: 'Makeni',
    category: 'Vegetables',
    farmer_name: 'Mohamed Kamara',
    phone: '+232 76 222 5555',
    image_url: 'https://images.unsplash.com/photo-1584622181563-430f63602d4b?auto=format&fit=crop&w=500&q=80',
    created_at: new Date().toISOString()
  },
  {
    name: 'Tomatoes',
    name_lower: 'tomatoes',
    price: 42000,
    location: 'Western Area',
    category: 'Vegetables',
    farmer_name: 'Aisha Bangura',
    phone: '+232 78 666 7777',
    image_url: 'https://images.unsplash.com/photo-1592924357228-91a4daadcccf?auto=format&fit=crop&w=500&q=80',
    created_at: new Date().toISOString()
  },
  {
    name: 'Onions',
    name_lower: 'onions',
    price: 38000,
    location: 'Bo',
    category: 'Vegetables',
    farmer_name: 'Sorie Jalloh',
    phone: '+232 76 999 0000',
    image_url: 'https://images.unsplash.com/photo-1587049352520-92c13ccb0bc0?auto=format&fit=crop&w=500&q=80',
    created_at: new Date().toISOString()
  },
  {
    name: 'Palm Oil',
    name_lower: 'palm oil',
    price: 150000,
    location: 'Kenema',
    category: 'Oils',
    farmer_name: 'David Koroma',
    phone: '+232 79 888 1111',
    image_url: 'https://images.unsplash.com/photo-1513621776144-60967b0f800f?auto=format&fit=crop&w=500&q=80',
    created_at: new Date().toISOString()
  }
];

// ============ MAIN MIGRATION LOGIC ============
async function migrateCrops() {
  try {
    // Initialize Firebase Admin SDK
    const serviceAccount = require(FIREBASE_KEY_PATH);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: FIREBASE_PROJECT_ID
    });

    const db = admin.firestore();
    const cropsCollection = db.collection('crops');

    console.log(`🌱 Starting migration: Adding ${SAMPLE_CROPS.length} crop documents to Firestore...`);
    console.log(`📍 Collection: crops`);
    console.log(`🔐 Project: ${FIREBASE_PROJECT_ID}\n`);

    // Add each crop document
    let successCount = 0;
    for (const crop of SAMPLE_CROPS) {
      try {
        const docRef = await cropsCollection.add(crop);
        console.log(`✅ Added: "${crop.name}" (ID: ${docRef.id})`);
        successCount++;
      } catch (err) {
        console.error(`❌ Failed to add "${crop.name}":`, err.message);
      }
    }

    console.log(`\n✨ Migration complete! ${successCount}/${SAMPLE_CROPS.length} crops added successfully.`);

    // Verify data was written
    const snapshot = await cropsCollection.get();
    console.log(`\n📊 Firestore 'crops' collection now contains ${snapshot.size} documents.`);

    await admin.app().delete();
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

// Run migration
migrateCrops();
