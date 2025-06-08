const admin = require('firebase-admin');

// Глобальная переменная для отслеживания инициализации
let firebaseInitialized = false;

// Функция инициализации Firebase
function initializeFirebase() {
    if (firebaseInitialized || admin.apps.length > 0) {
        return true;
    }
    
    try {
        const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
        
        if (!serviceAccountJson) {
            throw new Error('Missing Firebase Service Account');
        }
        
        const serviceAccount = JSON.parse(serviceAccountJson);
        
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: serviceAccount.project_id
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
        cacheLoaded = true;
    }
}

// Создание ID трека
function createTrackId(artist, title) {
    const clean = (text) => (text || '').toLowerCase().trim().replace(/[^\w\s\u0400-\u04FF]/g, '').replace(/\s+/g, '_');
    return `${clean(artist)}_${clean(title)}`;
}

// Валидация трека
function isValidTrack(data) {
    if (!data || typeof data !== 'object') {
        console.log('❌ Данные не объект:', typeof data, data);
        return false;
    }
    
    const artist = (data.artist || '').trim();
    const title = (data.title || '').trim();
    
    console.log('🔍 Проверка полей:');
    console.log('- artist:', `"${artist}" (length: ${artist.length})`);
    console.log('- title:', `"${title}" (length: ${title.length})`);
    
    if (!artist || !title) {
        console.log('❌ Отсутствует исполнитель или название');
        return false;
    }
    
    // Фильтруем служебную информацию
    const blacklist = ['реклама', 'джингл', 'позывные', 'promo', 'jingle'];
    const text = `${artist} ${title}`.toLowerCase();
    
    for (const word of blacklist) {
        if (text.includes(word)) {
            console.log(`❌ Отфильтровано: ${word}`);
            return false;
        }
    }
    
    console.log('✅ Валидация пройдена');
    return true;
}

// ГЛАВНАЯ ФУНКЦИЯ
exports.handler = async (event, context) => {
    console.log('🚀 === НОВЫЙ CALLBACK ЗАПРОС ===');
    console.log('📅 Время:', new Date().toISOString());
    
    // CORS заголовки
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
        'Content-Type': 'application/json'
    };
    
    // OPTIONS запрос
    if (event.httpMethod === 'OPTIONS') {
        console.log('📨 OPTIONS запрос - возвращаем CORS');
        return { statusCode: 200, headers, body: '' };
    }
    
    try {
        // ПОДРОБНОЕ ЛОГИРОВАНИЕ ВХОДЯЩИХ ДАННЫХ
        console.log('📊 === АНАЛИЗ ЗАПРОСА ===');
        console.log('🔸 HTTP Method:', event.httpMethod);
        console.log('🔸 Path:', event.path);
        console.log('🔸 Query String Parameters:', JSON.stringify(event.queryStringParameters, null, 2));
        console.log('🔸 Headers:', JSON.stringify(event.headers, null, 2));
        console.log('🔸 Body (raw):', event.body);
        console.log('🔸 Body type:', typeof event.body);
        console.log('🔸 Body length:', event.body ? event.body.length : 0);
        console.log('🔸 IsBase64Encoded:', event.isBase64Encoded);
        
        // Инициализация Firebase
        if (!initializeFirebase()) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Firebase initialization failed' })
            };
        }
        
        await loadCache();
        
        // ПАРСИНГ ДАННЫХ ТРЕКА
        let trackData = {};
        
        console.log('📝 === ПАРСИНГ ДАННЫХ ===');
        
        if (event.httpMethod === 'POST') {
            console.log('📨 POST запрос');
            
            if (event.body) {
                console.log('📄 Body содержимое:', event.body);
                
                // Пробуем различные форматы
                try {
                    // JSON формат
                    trackData = JSON.parse(event.body);
                    console.log('✅ Успешно распарсено как JSON:', trackData);
                } catch (jsonError) {
                    console.log('⚠️ Не JSON, пробуем URL-encoded');
                    
                    try {
                        // URL-encoded формат
                        const params = new URLSearchParams(event.body);
                        trackData = Object.fromEntries(params);
                        console.log('✅ Успешно распарсено как URL-encoded:', trackData);
                    } catch (urlError) {
                        console.log('⚠️ Не URL-encoded, пробуем простой текст');
                        
                        // Возможно это простой текст
                        if (event.body.includes('=')) {
                            // Ручной парсинг key=value&key2=value2
                            trackData = {};
                            event.body.split('&').forEach(pair => {
                                const [key, value] = pair.split('=');
                                if (key && value) {
                                    trackData[decodeURIComponent(key)] = decodeURIComponent(value);
                                }
                            });
                            console.log('✅ Ручной парсинг URL-encoded:', trackData);
                        } else {
                            console.log('❌ Неизвестный формат body');
                            trackData = { raw_body: event.body };
                        }
                    }
                }
            } else {
                console.log('⚠️ POST без body');
            }
            
        } else if (event.httpMethod === 'GET') {
            console.log('📨 GET запрос');
            trackData = event.queryStringParameters || {};
            console.log('📄 Query параметры:', trackData);
        }
        
        console.log('🎯 Финальные данные трека:', JSON.stringify(trackData, null, 2));
        
        // ВОЗВРАЩАЕМ ПОДРОБНУЮ ИНФОРМАЦИЮ ДЛЯ ОТЛАДКИ
        const debugResponse = {
            success: true,
            message: 'Callback received for debugging',
            debug: {
                method: event.httpMethod,
                receivedData: trackData,
                hasArtist: !!(trackData.artist),
                hasTitle: !!(trackData.title),
                allKeys: Object.keys(trackData),
                queryParams: event.queryStringParameters,
                bodyLength: event.body ? event.body.length : 0,
                headers: event.headers
            },
            timestamp: new Date().toISOString()
        };
        
        // Если данные выглядят валидно, попробуем обработать
        if (isValidTrack(trackData)) {
            const artist = trackData.artist.trim();
            const title = trackData.title.trim();
            const trackId = createTrackId(artist, title);
            
            console.log(`🎵 Обрабатываем: "${artist} - ${title}"`);
            
            if (!knownTracks.has(trackId)) {
                console.log('🆕 НОВЫЙ ТРЕК!');
                
                knownTracks.add(trackId);
                
                const db = admin.firestore();
                const timestamp = admin.firestore.FieldValue.serverTimestamp();
                
                // Сохраняем
                await db.collection('known_tracks').doc(trackId).set({
                    trackId,
                    artist,
                    title,
                    firstSeen: timestamp
                });
                
                await db.collection('new_tracks').add({
                    artist,
                    title,
                    trackId,
                    addedToLibrary: timestamp,
                    firstPlayed: timestamp,
                    source: 'myradio24'
                });
                
                console.log(`✅ Трек добавлен: ${artist} - ${title}`);
                
                debugResponse.trackProcessed = true;
                debugResponse.track = { artist, title, trackId };
                debugResponse.isNew = true;
                
            } else {
                console.log('ℹ️ Трек уже известен');
                debugResponse.trackProcessed = true;
                debugResponse.track = { artist, title, trackId };
                debugResponse.isNew = false;
            }
        } else {
            console.log('❌ Трек не прошел валидацию');
            debugResponse.trackProcessed = false;
            debugResponse.validationFailed = true;
        }
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(debugResponse, null, 2)
        };
        
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Server error',
                message: error.message,
                debug: {
                    method: event.httpMethod,
                    body: event.body,
                    queryParams: event.queryStringParameters
                }
            })
        };
    }
};
