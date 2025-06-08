const admin = require('firebase-admin');

// Глобальная инициализация Firebase
let firebaseInitialized = false;

// Функция инициализации Firebase
function initializeFirebase() {
    if (firebaseInitialized) {
        return true;
    }
    
    try {
        // Проверяем наличие переменных окружения
        const privateKey = process.env.FIREBASE_PRIVATE_KEY;
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
        
        console.log('🔍 Проверка переменных окружения:');
        console.log('Private key exists:', !!privateKey);
        console.log('Client email exists:', !!clientEmail);
        console.log('Client email value:', clientEmail);
        
        if (!privateKey || !clientEmail) {
            throw new Error(`Missing environment variables. Private key: ${!!privateKey}, Client email: ${!!clientEmail}`);
        }
        
        // Обрабатываем приватный ключ
        let processedPrivateKey = privateKey;
        
        // Если ключ в одну строку, добавляем переносы
        if (!processedPrivateKey.includes('\n')) {
            processedPrivateKey = processedPrivateKey
                .replace(/-----BEGIN PRIVATE KEY-----/, '-----BEGIN PRIVATE KEY-----\n')
                .replace(/-----END PRIVATE KEY-----/, '\n-----END PRIVATE KEY-----')
                .replace(/(.{64})/g, '$1\n')
                .replace(/\n\n/g, '\n');
        }
        
        // Заменяем \\n на реальные переносы строк
        processedPrivateKey = processedPrivateKey.replace(/\\n/g, '\n');
        
        console.log('🔑 Processed private key length:', processedPrivateKey.length);
        console.log('🔑 Private key starts with:', processedPrivateKey.substring(0, 50));
        
        // Инициализируем Firebase Admin SDK
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: "pulse-fm-84a48",
                privateKey: processedPrivateKey,
                clientEmail: clientEmail,
            }),
            databaseURL: "https://pulse-fm-84a48-default-rtdb.firebaseio.com"
        });
        
        firebaseInitialized = true;
        console.log('✅ Firebase Admin инициализирован успешно');
        return true;
        
    } catch (error) {
        console.error('❌ Ошибка инициализации Firebase:', error.message);
        console.error('❌ Stack trace:', error.stack);
        return false;
    }
}

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
        
        const db = admin.firestore();
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
            path: event.path,
            headers: event.headers,
            queryStringParameters: event.queryStringParameters
        });
        
        // Инициализируем Firebase
        if (!initializeFirebase()) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: 'Firebase initialization failed',
                    timestamp: new Date().toISOString()
                })
            };
        }
        
        await initializeCache();
        
        // Получаем данные трека
        let trackData;
        
        if (event.httpMethod === 'POST' && event.body) {
            try {
                trackData = JSON.parse(event.body);
            } catch (e) {
                console.log('⚠️ Не удалось распарсить JSON, используем как есть');
                trackData = event.body;
            }
        } else if (event.httpMethod === 'GET') {
            trackData = event.queryStringParameters || {};
        } else {
            return {
                statusCode: 405,
                headers,
                body: JSON.stringify({ error: 'Method not allowed' })
            };
        }
        
        console.log('📝 Данные трека:', trackData);
        
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
            console.log('🆕 Новый трек найден!');
            
            knownTracksCache.add(trackId);
            
            const db = admin.firestore();
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
        console.error('❌ Ошибка обработки:', error);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Internal server error',
                message: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            })
        };
    }
};
