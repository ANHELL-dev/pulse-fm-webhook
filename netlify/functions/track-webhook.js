const admin = require('firebase-admin');

// Инициализация Firebase Admin SDK
if (!admin.apps.length) {
    try {
        const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
        
        if (!privateKey || !process.env.FIREBASE_CLIENT_EMAIL) {
            throw new Error('Firebase credentials not configured');
        }
        
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: "pulse-fm-84a48",
                privateKey: privateKey,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            }),
            databaseURL: "https://pulse-fm-84a48.firebaseapp.com"
        });
        
        console.log('✅ Firebase Admin инициализирован');
    } catch (error) {
        console.error('❌ Ошибка инициализации Firebase:', error);
    }
}

const db = admin.firestore();

// Кэш для известных треков
let knownTracksCache = new Set();
let cacheInitialized = false;
let lastCacheUpdate = 0;

// Инициализация кэша
async function initializeCache() {
    const now = Date.now();
    
    if (cacheInitialized && (now - lastCacheUpdate) < 300000) {
        return;
    }
    
    try {
        console.log('🔄 Обновление кэша известных треков...');
        
        const snapshot = await db.collection('known_tracks')
            .select('trackId')
            .get();
        
        knownTracksCache.clear();
        snapshot.forEach(doc => {
            knownTracksCache.add(doc.data().trackId);
        });
        
        cacheInitialized = true;
        lastCacheUpdate = now;
        
        console.log(`✅ Кэш обновлен: ${knownTracksCache.size} известных треков`);
    } catch (error) {
        console.error('❌ Ошибка инициализации кэша:', error);
        cacheInitialized = true;
    }
}

// Создание ID трека
function createTrackId(artist, title) {
    const normalizeText = (text) => {
        return (text || '')
            .toLowerCase()
            .trim()
            .replace(/[^\w\s\u0400-\u04FF]/g, '')
            .replace(/\s+/g, ' ')
            .replace(/\s/g, '_');
    };
    
    const cleanArtist = normalizeText(artist);
    const cleanTitle = normalizeText(title);
    
    return `${cleanArtist}_${cleanTitle}`;
}

// Валидация данных
function validateTrackData(data) {
    if (!data) return false;
    
    const artist = (data.artist || '').trim();
    const title = (data.title || '').trim();
    
    if (!artist || !title) return false;
    
    const serviceWords = ['реклама', 'джингл', 'позывные', 'promo', 'jingle', 'id'];
    const fullText = `${artist} ${title}`.toLowerCase();
    
    for (const word of serviceWords) {
        if (fullText.includes(word)) return false;
    }
    
    return true;
}

// Основная функция
exports.handler = async (event, context) => {
    // CORS заголовки
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };
    
    // Обработка OPTIONS запроса
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }
    
    try {
        console.log('📨 Получен запрос:', {
            method: event.httpMethod,
            body: event.body,
            queryStringParameters: event.queryStringParameters
        });
        
        await initializeCache();
        
        // Получаем данные трека
        let trackData;
        
        if (event.httpMethod === 'POST' && event.body) {
            trackData = JSON.parse(event.body);
        } else if (event.httpMethod === 'GET') {
            trackData = event.queryStringParameters || {};
        } else {
            return {
                statusCode: 405,
                headers,
                body: JSON.stringify({ error: 'Method not allowed' })
            };
        }
        
        // Валидация
        if (!validateTrackData(trackData)) {
            console.log('⚠️ Невалидные данные:', trackData);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Invalid track data',
                    received: trackData 
                })
            };
        }
        
        const artist = trackData.artist.trim();
        const title = trackData.title.trim();
        const trackId = createTrackId(artist, title);
        
        console.log(`🎵 Обработка: "${artist} - ${title}" (ID: ${trackId})`);
        
        // Проверяем новизну
        if (!knownTracksCache.has(trackId)) {
            console.log('🆕 Новый трек!');
            
            knownTracksCache.add(trackId);
            
            const timestamp = admin.firestore.FieldValue.serverTimestamp();
            
            // Сохраняем как известный трек
            await db.collection('known_tracks').doc(trackId).set({
                trackId: trackId,
                artist: artist,
                title: title,
                firstSeen: timestamp,
                duration: trackData.duration || null,
                bitrate: trackData.bitrate || null,
                genre: trackData.genre || null,
                album: trackData.album || null
            });
            
            // Добавляем в новинки
            await db.collection('new_tracks').add({
                artist: artist,
                title: title,
                trackId: trackId,
                addedToLibrary: timestamp,
                firstPlayed: timestamp,
                duration: trackData.duration || null,
                bitrate: trackData.bitrate || null,
                genre: trackData.genre || null,
                album: trackData.album || null,
                source: 'myradio24_callback'
            });
            
            console.log(`✅ Новый трек добавлен: ${artist} - ${title}`);
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ 
                    success: true, 
                    message: 'New track added',
                    track: { artist, title, trackId },
                    isNew: true
                })
            };
            
        } else {
            console.log('ℹ️ Трек уже известен');
