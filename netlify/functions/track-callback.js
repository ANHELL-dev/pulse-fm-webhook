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
        console.log(`✅ Кэш загружен: ${knownTracks.size} известных треков`);
    } catch (error) {
        console.error('❌ Ошибка загрузки кэша:', error);
        cacheLoaded = true;
    }
}

// Парсинг трека из различных форматов (специально для myradio24)
function parseTrackData(data) {
    console.log('🔍 Парсинг данных myradio24:', JSON.stringify(data, null, 2));
    
    let artist = '';
    let title = '';
    
    // Приоритет 1: Поле song (полная информация о треке)
    if (data.song && data.song !== data.title) {
        const trackParts = data.song.split(' - ');
        if (trackParts.length >= 2) {
            artist = trackParts[0].trim();
            title = trackParts.slice(1).join(' - ').trim();
            console.log('✅ Приоритет: Формат song найден, разделен по " - "');
        } else {
            // Если нет разделителя " - ", используем artist и title отдельно
            if (data.artist && data.title && data.title !== 'PULSE FM') {
                artist = data.artist;
                title = data.title;
                console.log('✅ Fallback: используем artist/title');
            }
        }
    }
    // Приоритет 2: Формат myradio24: отдельные поля artist и songtitle
    else if (data.artist && data.songtitle && data.songtitle !== 'PULSE FM') {
        artist = data.artist;
        title = data.songtitle;
        console.log('✅ Формат myradio24 artist/songtitle найден');
    }
    // Приоритет 3: artist и title (но проверяем, что title не название станции)
    else if (data.artist && data.title && data.title !== 'PULSE FM' && data.title !== data.djname) {
        artist = data.artist;
        title = data.title;
        console.log('✅ Формат artist/title найден');
    }
    // Приоритет 4: Формат с объединенным полем song
    else if (data.song) {
        const trackParts = data.song.split(' - ');
        if (trackParts.length >= 2) {
            artist = trackParts[0].trim();
            title = trackParts.slice(1).join(' - ').trim();
            console.log('✅ Формат song найден, разделен по " - "');
        } else {
            // Если нет разделителя " - ", пробуем другие разделители
            const altSeparators = [' – ', ' — ', ' | ', ' / '];
            for (const sep of altSeparators) {
                const parts = data.song.split(sep);
                if (parts.length >= 2) {
                    artist = parts[0].trim();
                    title = parts.slice(1).join(sep).trim();
                    console.log(`✅ Формат song найден с разделителем "${sep}"`);
                    break;
                }
            }
        }
    }
    // Приоритет 5: Формат nowplaying
    else if (data.nowplaying) {
        const trackParts = data.nowplaying.split(' - ');
        if (trackParts.length >= 2) {
            artist = trackParts[0].trim();
            title = trackParts.slice(1).join(' - ').trim();
            console.log('✅ Формат nowplaying найден');
        }
    }
    // Приоритет 6: Формат track
    else if (data.track) {
        const trackParts = data.track.split(' - ');
        if (trackParts.length >= 2) {
            artist = trackParts[0].trim();
            title = trackParts.slice(1).join(' - ').trim();
            console.log('✅ Формат track найден');
        }
    }
    
    // Очищаем данные от HTML-кодов и лишних символов
    artist = decodeHtmlEntities(artist.trim());
    title = decodeHtmlEntities(title.trim());
    
    console.log(`🎵 Результат парсинга: "${artist}" - "${title}"`);
    
    return { artist, title };
}

// Функция декодирования HTML-сущностей
function decodeHtmlEntities(text) {
    const entities = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#039;': "'",
        '&nbsp;': ' '
    };
    
    return text.replace(/&[a-zA-Z0-9#]+;/g, (entity) => {
        return entities[entity] || entity;
    });
}

// Создание ID трека
function createTrackId(artist, title) {
    const clean = (text) => (text || '')
        .toLowerCase()
        .trim()
        .replace(/[^\w\s\u0400-\u04FF]/g, '') // Убираем спецсимволы
        .replace(/\s+/g, '_') // Заменяем пробелы на подчеркивания
        .replace(/_{2,}/g, '_') // Убираем двойные подчеркивания
        .replace(/^_|_$/g, ''); // Убираем подчеркивания в начале и конце
    
    return `${clean(artist)}_${clean(title)}`;
}

// Валидация трека
function isValidTrack(artist, title) {
    if (!artist || !title) {
        console.log('❌ Отсутствует исполнитель или название');
        return false;
    }
    
    // Проверяем минимальную длину
    if (artist.length < 2 || title.length < 2) {
        console.log('❌ Слишком короткие исполнитель или название');
        return false;
    }
    
    // Фильтруем служебную информацию
    const blacklist = [
        'реклама', 'джингл', 'позывные', 'promo', 'jingle', 'commercial', 'advertisement',
        'station id', 'radio id', 'анонс', 'объявление', 'reklama', 'reclama',
        'podcast', 'подкаст', 'музгост', 'dj set', 'mix set', 'radio show'
    ];
    
    const text = `${artist} ${title}`.toLowerCase();
    
    for (const word of blacklist) {
        if (text.includes(word)) {
            console.log(`❌ Отфильтровано как служебная информация: ${word}`);
            return false;
        }
    }
    
    console.log('✅ Валидация пройдена');
    return true;
}

// ГЛАВНАЯ ФУНКЦИЯ
exports.handler = async (event, context) => {
    const startTime = Date.now();
    console.log('🚀 === CALLBACK ОТ MYRADIO24 ===');
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
        console.log('📨 OPTIONS запрос');
        return { statusCode: 200, headers, body: '' };
    }
    
    try {
        // Логирование входящих данных
        console.log('📊 HTTP Method:', event.httpMethod);
        console.log('📊 Query Params:', JSON.stringify(event.queryStringParameters, null, 2));
        console.log('📊 Body:', event.body);
        console.log('📊 Headers:', JSON.stringify(event.headers, null, 2));
        
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
        
        await loadCache();
        
        // Парсинг данных трека
        let trackData = {};
        
        if (event.httpMethod === 'POST') {
            console.log('📨 POST запрос от myradio24');
            
            if (event.body) {
                try {
                    // Пробуем JSON
                    trackData = JSON.parse(event.body);
                    console.log('✅ JSON данные получены:', trackData);
                } catch (jsonError) {
                    console.log('⚠️ Не JSON, пробуем URL-encoded');
                    
                    try {
                        // URL-encoded
                        const params = new URLSearchParams(event.body);
                        trackData = Object.fromEntries(params);
                        console.log('✅ URL-encoded данные получены:', trackData);
                    } catch (urlError) {
                        console.log('❌ Неизвестный формат данных');
                        trackData = { raw_body: event.body };
                    }
                }
            } else {
                console.log('⚠️ POST запрос без body');
            }
            
        } else if (event.httpMethod === 'GET') {
            console.log('📨 GET запрос');
            trackData = event.queryStringParameters || {};
        }
        
        console.log('🎯 Данные для обработки:', JSON.stringify(trackData, null, 2));
        
        // Парсим трек
        const { artist, title } = parseTrackData(trackData);
        
        // Подготавливаем ответ
        const response = {
            success: true,
            timestamp: new Date().toISOString(),
            processing_time_ms: Date.now() - startTime,
            data: {
                method: event.httpMethod,
                received: trackData,
                parsed: { artist, title }
            }
        };
        
        // Обрабатываем трек если данные валидны
        if (isValidTrack(artist, title)) {
            const trackId = createTrackId(artist, title);
            
            console.log(`🎵 Обрабатываем трек: "${artist} - ${title}" (ID: ${trackId})`);
            
            if (!knownTracks.has(trackId)) {
                console.log('🆕 НОВЫЙ ТРЕК ОБНАРУЖЕН!');
                
                try {
                    knownTracks.add(trackId);
                    
                    const db = admin.firestore();
                    const timestamp = admin.firestore.FieldValue.serverTimestamp();
                    
                    // Сохраняем как известный трек
                    await db.collection('known_tracks').doc(trackId).set({
                        trackId,
                        artist,
                        title,
                        firstSeen: timestamp,
                        source: 'myradio24_callback'
                    });
                    
                    // Добавляем в новинки
                    await db.collection('new_tracks').add({
                        artist,
                        title,
                        trackId,
                        addedToLibrary: timestamp,
                        firstPlayed: timestamp,
                        source: 'myradio24_callback',
                        radioStation: 'PULSE FM'
                    });
                    
                    console.log(`✅ Новый трек добавлен в базу: ${artist} - ${title}`);
                    
                    response.result = 'new_track_added';
                    response.track = { artist, title, trackId };
                    response.message = `Новый трек "${artist} - ${title}" добавлен в систему новинок!`;
                    
                } catch (dbError) {
                    console.error('❌ Ошибка при сохранении в базу:', dbError);
                    response.result = 'database_error';
                    response.error = dbError.message;
                }
                
            } else {
                console.log('ℹ️ Трек уже известен системе');
                response.result = 'track_known';
                response.track = { artist, title, trackId };
                response.message = `Трек "${artist} - ${title}" уже известен системе`;
            }
        } else {
            console.log('❌ Трек не прошел валидацию');
            response.result = 'validation_failed';
            response.message = 'Трек не прошел валидацию (отсутствуют данные или служебная информация)';
        }
        
        console.log('📤 Отправляем ответ:', response.result);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(response, null, 2)
        };
        
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
        
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
