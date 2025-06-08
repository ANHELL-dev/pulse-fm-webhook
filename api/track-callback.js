// server.js
// Серверный скрипт для обработки Callback URL от myradio24
// Можно развернуть на Vercel, Netlify Functions, или другом сервисе

const admin = require('firebase-admin');

// Инициализация Firebase Admin SDK
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            // Замените на ваши реальные данные Firebase Service Account
            projectId: "pulse-fm-84a48",
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
        databaseURL: "https://pulse-fm-84a48.firebaseapp.com"
    });
}

const db = admin.firestore();

// Хранилище для отслеживания треков (в продакшене лучше использовать Redis или БД)
let knownTracks = new Set();
let isInitialized = false;

// Инициализация - загружаем известные треки из Firebase
async function initializeKnownTracks() {
    if (isInitialized) return;
    
    try {
        const snapshot = await db.collection('known_tracks').get();
        snapshot.forEach(doc => {
            knownTracks.add(doc.data().trackId);
        });
        isInitialized = true;
        console.log(`Загружено ${knownTracks.size} известных треков`);
    } catch (error) {
        console.error('Ошибка инициализации:', error);
        isInitialized = true; // Продолжаем работу даже при ошибке
    }
}

// Основная функция обработки webhook
async function handleTrackCallback(req, res) {
    try {
        await initializeKnownTracks();
        
        // Получаем данные о треке от myradio24
        const trackData = req.body;
        
        // Создаем уникальный ID трека (комбинация исполнителя и названия)
        const trackId = createTrackId(trackData.artist, trackData.title);
        
        console.log(`Получен трек: ${trackData.artist} - ${trackData.title}`);
        
        // Проверяем, новый ли это трек
        if (!knownTracks.has(trackId)) {
            console.log('Найден новый трек!');
            
            // Добавляем в список известных треков
            knownTracks.add(trackId);
            
            // Сохраняем в Firebase как известный трек
            await db.collection('known_tracks').doc(trackId).set({
                trackId: trackId,
                artist: trackData.artist || 'Неизвестный исполнитель',
                title: trackData.title || 'Неизвестный трек',
                firstSeen: admin.firestore.FieldValue.serverTimestamp()
            });
            
            // Добавляем в коллекцию новинок
            await db.collection('new_tracks').add({
                artist: trackData.artist || 'Неизвестный исполнитель',
                title: trackData.title || 'Неизвестный трек',
                trackId: trackId,
                addedToLibrary: admin.firestore.FieldValue.serverTimestamp(),
                firstPlayed: admin.firestore.FieldValue.serverTimestamp(),
                // Дополнительные данные от callback
                duration: trackData.duration || null,
                bitrate: trackData.bitrate || null,
                genre: trackData.genre || null,
                album: trackData.album || null
            });
            
            console.log(`Новый трек добавлен в базу: ${trackData.artist} - ${trackData.title}`);
        }
        
        res.status(200).json({ success: true, message: 'Track processed' });
        
    } catch (error) {
        console.error('Ошибка обработки callback:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

// Создание уникального ID трека
function createTrackId(artist, title) {
    const cleanArtist = (artist || '').toLowerCase().trim().replace(/[^a-zа-я0-9]/g, '');
    const cleanTitle = (title || '').toLowerCase().trim().replace(/[^a-zа-я0-9]/g, '');
    return `${cleanArtist}_${cleanTitle}`;
}

// API endpoint для очистки старых новинок (опционально)
async function cleanupOldTracks(req, res) {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const snapshot = await db.collection('new_tracks')
            .where('addedToLibrary', '<', thirtyDaysAgo)
            .get();
        
        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        
        await batch.commit();
        
        res.json({ 
            success: true, 
            message: `Удалено ${snapshot.size} старых треков` 
        });
    } catch (error) {
        console.error('Ошибка очистки:', error);
        res.status(500).json({ error: 'Cleanup error' });
    }
}

// Экспорт для разных платформ

// Для Vercel
module.exports = async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/track-callback') {
        return handleTrackCallback(req, res);
    } else if (req.method === 'POST' && req.url === '/api/cleanup') {
        return cleanupOldTracks(req, res);
    } else {
        res.status(404).json({ error: 'Not found' });
    }
};

// Для Express.js
// const express = require('express');
// const app = express();
// app.use(express.json());
// app.post('/api/track-callback', handleTrackCallback);
// app.post('/api/cleanup', cleanupOldTracks);
// app.listen(3000, () => console.log('Server running on port 3000'));
