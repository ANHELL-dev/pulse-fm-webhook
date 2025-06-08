const admin = require('firebase-admin');

// Глобальная переменная для отслеживания инициализации
let firebaseInitialized = false;

// Функция инициализации Firebase через JSON
function initializeFirebase() {
    if (firebaseInitialized || admin.apps.length > 0) {
        console.log('✅ Firebase уже инициализирован');
        return true;
    }
    
    try {
        console.log('🔄 Инициализация Firebase...');
        
        // Проверяем наличие JSON переменной
        const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
        
        if (!serviceAccountJson) {
            throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable not found');
        }
        
        console.log('📝 Service account JSON найден, длина:', serviceAccountJson.length);
        
        // Парсим JSON
        let serviceAccount;
        try {
            serviceAccount = JSON.parse(serviceAccountJson);
            console.log('✅ JSON успешно распарсен');
            console.log('📋 Project ID:', serviceAccount.project_id);
            console.log('📋 Client Email:', serviceAccount.client_email);
        } catch (parseError) {
            throw new Error(`Failed to parse service account JSON: ${parseError.message}`);
        }
        
        // Инициализируем Firebase Admin SDK
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: serviceAccount.project_id
        });
        
        firebaseInitialized = true;
        console.log('✅ Firebase Admin SDK успешно инициализирован');
        return true;
        
    } catch (error) {
        console.error('❌ Ошибка инициализации Firebase:', error.message);
        console.error('❌ Stack trace:', error.stack);
        return false;
    }
}

// Кэш для известных треков
let knownTracks = new Set();
let cacheLoaded = false;

// Загрузка кэша известных треков
async function loadCache() {
    if (cacheLoaded) {
        console.log('ℹ️ Кэш уже загружен');
        return;
    }
    
    try {
        console.log('🔄 Загрузка кэша известных треков...');
        
        const db = admin.firestore();
        const snapshot = await db.collection('known_tracks').select('trackId').get();
        
        knownTracks.clear();
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.trackId) {
                knownTracks.add(data.trackId);
            }
        });
        
        cacheLoaded = true;
        console.log(`✅ Кэш загружен: ${knownTracks.size} известных треков`);
        
    } catch (error) {
        console.error('❌ Ошибка загрузки кэша:', error);
        // Продолжаем работу без кэша
        cacheLoaded = true;
    }
}

// Создание уникального ID трека
function createTrackId(artist, title) {
    const normalizeText = (text) => {
        return (text || '')
            .toLowerCase()
            .trim()
            .replace(/[^\w\s\u0400-\u04FF]/g, '') // Оставляем буквы, цифры, пробелы, кириллицу
            .replace(/\s+/g, '_') // Заменяем пробелы на подчеркивания
            .replace(/_{2,}/g, '_') // Убираем двойные подчеркивания
            .replace(/^_|_$/g, ''); // Убираем подчеркивания в начале и конце
    };
    
    const cleanArtist = normalizeText(artist);
    const cleanTitle = normalizeText(title);
    
    return `${cleanArtist}_${cleanTitle}`;
}

// Валидация данных трека
function isValidTrack(data) {
    if (!data || typeof data !== 'object') {
        return false;
    }
    
    const artist = (data.artist || '').trim();
    const title = (data.title || '').trim();
    
    // Проверяем наличие исполнителя и названия
    if (!artist || !title) {
        console.log('⚠️ Отсутствует исполнитель или название трека');
        return false;
    }
    
    // Фильтруем служебную информацию
    const blacklist = ['реклама', 'джингл', 'позывные', 'promo', 'jingle', 'id', 'commercial'];
    const fullText = `${artist} ${title}`.toLowerCase();
    
    for (const word of blacklist) {
        if (fullText.includes(word)) {
            console.log(`⚠️ Отфильтрован как служебная информация: ${word}`);
            return false;
        }
    }
    
    return true;
}

// ОСНОВНАЯ ФУНКЦИЯ - правильный экспорт для Netlify Functions
exports.handler = async (event, context) => {
    console.log('🚀 === НОВЫЙ ЗАПРОС К TRACK-CALLBACK ===');
    
    // CORS заголовки
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };
    
    // Обработка preflight запроса
    if (event.httpMethod === 'OPTIONS') {
        console.log('📨 OPTIONS запрос - возвращаем CORS заголовки');
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }
    
    try {
        console.log('📨 Метод запроса:', event.httpMethod);
        console.log('📨 Путь:', event.path);
        console.log('📨 Query параметры:', event.queryStringParameters);
        console.log('📨 Заголовки:', event.headers);
        
        // Инициализация Firebase
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
        
        // Загрузка кэша известных треков
        await loadCache();
        
        // Получение данных трека из запроса
        let trackData = {};
        
        if (event.httpMethod === 'POST') {
            if (event.body) {
                console.log('📝 POST body:', event.body);
                
                try {
                    // Пробуем парсить как JSON
                    trackData = JSON.parse(event.body);
                    console.log('✅ Данные распарсены как JSON');
                } catch (jsonError) {
                    console.log('⚠️ Не JSON данные, пробуем как form data');
                    
                    // Пробуем как URL-encoded данные
                    try {
                        const params = new URLSearchParams(event.body);
                        trackData = Object.fromEntries(params);
                        console.log('✅ Данные распарсены как form data');
                    } catch (formError) {
                        console.log('⚠️ Не удалось распарсить данные, используем как есть');
                        trackData = { raw: event.body };
                    }
                }
            } else {
                console.log('⚠️ POST запрос без body');
                trackData = {};
            }
        } else if (event.httpMethod === 'GET') {
            trackData = event.queryStringParameters || {};
            console.log('✅ Данные получены из query параметров');
        } else {
            return {
                statusCode: 405,
                headers,
                body: JSON.stringify({ error: 'Method not allowed' })
            };
        }
        
        console.log('📝 Финальные данные трека:', trackData);
        
        // Валидация данных трека
        if (!isValidTrack(trackData)) {
            console.log('❌ Валидация не прошла');
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Invalid track data',
                    received: trackData,
                    timestamp: new Date().toISOString()
                })
            };
        }
        
        const artist = trackData.artist.trim();
        const title = trackData.title.trim();
        const trackId = createTrackId(artist, title);
        
        console.log(`🎵 Обрабатываем трек: "${artist} - ${title}"`);
        console.log(`🔑 Track ID: ${trackId}`);
        
        // Проверяем, новый ли это трек
        if (!knownTracks.has(trackId)) {
            console.log('🆕 НАЙДЕН НОВЫЙ ТРЕК!');
            
            // Добавляем в локальный кэш
            knownTracks.add(trackId);
            
            const db = admin.firestore();
            const timestamp = admin.firestore.FieldValue.serverTimestamp();
            
            try {
                // Сохраняем как известный трек
                await db.collection('known_tracks').doc(trackId).set({
                    trackId: trackId,
                    artist: artist,
                    title: title,
                    firstSeen: timestamp,
                    createdAt: new Date().toISOString()
                });
                
                console.log('✅ Трек добавлен в known_tracks');
                
                // Добавляем в коллекцию новинок
                await db.collection('new_tracks').add({
                    artist: artist,
                    title: title,
                    trackId: trackId,
                    addedToLibrary: timestamp,
                    firstPlayed: timestamp,
                    source: 'myradio24_callback',
                    createdAt: new Date().toISOString()
                });
                
                console.log('✅ Трек добавлен в new_tracks');
                
            } catch (dbError) {
                console.error('❌ Ошибка при сохранении в базу:', dbError);
                throw dbError;
            }
            
            console.log(`🎉 Новый трек успешно обработан: ${artist} - ${title}`);
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ 
                    success: true, 
                    message: 'New track added successfully',
                    track: { 
                        artist: artist, 
                        title: title, 
                        trackId: trackId 
                    },
                    isNew: true,
                    timestamp: new Date().toISOString()
                })
            };
            
        } else {
            console.log('ℹ️ Трек уже известен, пропускаем');
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ 
                    success: true, 
                    message: 'Track already known',
                    track: { 
                        artist: artist, 
                        title: title, 
                        trackId: trackId 
                    },
                    isNew: false,
                    timestamp: new Date().toISOString()
                })
            };
        }
        
    } catch (error) {
        console.error('❌ Критическая ошибка в обработчике:', error);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Internal server error',
                message: error.message,
                timestamp: new Date().toISOString()
            })
        };
    }
};
