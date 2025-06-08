const admin = require('firebase-admin');

// Глобальная переменная для отслеживания инициализации
let firebaseInitialized = false;

// Функция инициализации Firebase
function initializeFirebase() {
    if (firebaseInitialized || admin.apps.length > 0) {
        return true;
    }
    
    try {
        const privateKey = process.env.FIREBASE_PRIVATE_KEY;
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
        
        if (!privateKey || !clientEmail) {
            throw new Error('Missing Firebase credentials');
        }
        
        // Простая обработка ключа
        let cleanKey = privateKey.replace(/\\n/g, '\n');
        
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: "pulse-fm-84a48",
                privateKey: cleanKey,
                clientEmail: clientEmail,
            })
        });
        
        firebaseInitialized = true;
        console.log('✅ Firebase инициализирован');
        return true;
        
    } catch (error) {
        console.error('❌ Firebase ошибка:', error);
        return false;
    }
}

// Кэш треков
let knownTracks = new Set();
let cacheLoaded = false;

// Загрузка кэша
async function loadCache() {
    if (cacheLoaded) return;
    
    try {
        const db = admin.firestore();
        const snapshot = await db.collection('known_tracks').select('trackId').get();
        
        knownTracks.clear();
        snapshot.forEach(doc => {
            knownTracks.add(doc.data().trackId);
        });
        
        cacheLoaded = true;
        console.log(`Загружено ${knownTracks.size} известных треков`);
    } catch (error) {
        console.error('Ошибка загрузки кэша:', error);
        cacheLoaded = true; // Продолжаем без кэша
    }
}

// Создание ID трека
function createTrackId(artist, title) {
    const clean = (text) => (text || '').toLowerCase().trim().replace(/[^\w\s\u0400-\u04FF]/g, '').replace(/\s+/g, '_');
    return `${clean(artist)}_${clean(title)}`;
}

// Валидация трека
function isValidTrack(data) {
    if (!data) return false;
    
    const artist = (data.artist || '').trim();
    const title = (data.title || '').trim();
    
    if (!artist || !title) return false;
    
    // Фильтруем служебную информацию
    const blacklist = ['реклама', 'джингл', 'позывные', 'promo', 'jingle'];
    const text = `${artist} ${title}`.toLowerCase();
    
    return !blacklist.some(word => text.includes(word));
}

// ГЛАВНАЯ ФУНКЦИЯ - правильный экспорт для Netlify
exports.handler = async (event, context) => {
    // CORS заголовки
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };
    
    // OPTIONS запрос
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    
    try {
        console.log('📨 Новый запрос:', event.httpMethod);
        
        // Инициализация
        if (!initializeFirebase()) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Firebase initialization failed' })
            };
        }
        
        await loadCache();
        
        // Получение данных трека
        let trackData = {};
        
        if (event.httpMethod === 'POST' && event.body) {
            try {
                trackData = JSON.parse(event.body);
            } catch (e) {
                console.log('Не JSON данные, пробуем как query string');
                // Если не JSON, возможно это form data
                const params = new URLSearchParams(event.body);
                trackData = Object.fromEntries(params);
            }
        } else if (event.httpMethod === 'GET') {
            trackData = event.queryStringParameters || {};
        }
        
        console.log('📝 Данные трека:', trackData);
        
        // Валидация
        if (!isValidTrack(trackData)) {
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
        
        console.log(`🎵 Трек: "${artist} - ${title}"`);
        
        // Проверка новизны
        if (!knownTracks.has(trackId)) {
            console.log('🆕 НОВЫЙ ТРЕК!');
            
            knownTracks.add(trackId);
            
            const db = admin.firestore();
            const timestamp = admin.firestore.FieldValue.serverTimestamp();
            
            // Сохраняем известный трек
            await db.collection('known_tracks').doc(trackId).set({
                trackId,
                artist,
                title,
                firstSeen: timestamp
            });
            
            // Добавляем в новинки
            await db.collection('new_tracks').add({
                artist,
                title,
                trackId,
                addedToLibrary: timestamp,
                firstPlayed: timestamp,
                source: 'myradio24'
            });
            
            console.log(`✅ Трек добавлен: ${artist} - ${title}`);
            
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
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ 
                    success: true, 
                    message: 'Track already known',
                    track: { artist, title, trackId },
                    isNew: false
                })
            };
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Server error',
                message: error.message
            })
        };
    }
};
