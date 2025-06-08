const admin = require('firebase-admin');

// Глобальная инициализация Firebase
let firebaseInitialized = false;

function initializeFirebase() {
    if (firebaseInitialized) {
        return true;
    }
    
    try {
        const privateKey = process.env.FIREBASE_PRIVATE_KEY;
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
        
        console.log('🔍 Status check - переменные окружения:');
        console.log('Private key exists:', !!privateKey);
        console.log('Client email exists:', !!clientEmail);
        console.log('Client email:', clientEmail);
        
        if (!privateKey || !clientEmail) {
            throw new Error(`Missing environment variables. Private key: ${!!privateKey}, Client email: ${!!clientEmail}`);
        }
        
        // Обрабатываем приватный ключ
        let processedPrivateKey = privateKey;
        
        if (!processedPrivateKey.includes('\n')) {
            processedPrivateKey = processedPrivateKey
                .replace(/-----BEGIN PRIVATE KEY-----/, '-----BEGIN PRIVATE KEY-----\n')
                .replace(/-----END PRIVATE KEY-----/, '\n-----END PRIVATE KEY-----')
                .replace(/(.{64})/g, '$1\n')
                .replace(/\n\n/g, '\n');
        }
        
        processedPrivateKey = processedPrivateKey.replace(/\\n/g, '\n');
        
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: "pulse-fm-84a48",
                privateKey: processedPrivateKey,
                clientEmail: clientEmail,
            }),
            databaseURL: "https://pulse-fm-84a48-default-rtdb.firebaseio.com"
        });
        
        firebaseInitialized = true;
        console.log('✅ Firebase инициализирован для статуса');
        return true;
        
    } catch (error) {
        console.error('❌ Ошибка инициализации Firebase в статусе:', error);
        return false;
    }
}

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
    };
    
    try {
        console.log('📊 Запрос статуса системы');
        
        // Проверяем переменные окружения
        const hasPrivateKey = !!process.env.FIREBASE_PRIVATE_KEY;
        const hasClientEmail = !!process.env.FIREBASE_CLIENT_EMAIL;
        
        if (!hasPrivateKey || !hasClientEmail) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    status: 'error',
                    message: 'Environment variables not configured',
                    details: {
                        hasPrivateKey,
                        hasClientEmail,
                        clientEmail: process.env.FIREBASE_CLIENT_EMAIL || 'not set'
                    },
                    timestamp: new Date().toISOString()
                })
            };
        }
        
        // Инициализируем Firebase
        if (!initializeFirebase()) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    status: 'error',
                    message: 'Firebase initialization failed',
                    details: {
                        hasPrivateKey,
                        hasClientEmail,
                        clientEmail: process.env.FIREBASE_CLIENT_EMAIL
                    },
                    timestamp: new Date().toISOString()
                })
            };
        }
        
        const db = admin.firestore();
        
        // Получаем статистику
        console.log('📈 Получение статистики...');
        
        const [newTracksSnap, knownTracksSnap] = await Promise.all([
            db.collection('new_tracks').count().get(),
            db.collection('known_tracks').count().get()
        ]);
        
        const recentTracksSnap = await db.collection('new_tracks')
            .orderBy('addedToLibrary', 'desc')
            .limit(5)
            .get();
        
        const recentTracks = recentTracksSnap.docs.map(doc => {
            const data = doc.data();
            return {
                artist: data.artist,
                title: data.title,
                addedAt: data.addedToLibrary?.toDate()?.toISOString()
            };
        });
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                status: 'ok',
                timestamp: new Date().toISOString(),
                firebase: {
                    initialized: firebaseInitialized,
                    projectId: 'pulse-fm-84a48'
                },
                stats: {
                    totalNewTracks: newTracksSnap.data().count,
                    totalKnownTracks: knownTracksSnap.data().count
                },
                recentTracks: recentTracks,
                environment: {
                    hasPrivateKey,
                    hasClientEmail,
                    netlifyFunction: true
                },
                version: '1.0.0'
            })
        };
        
    } catch (error) {
        console.error('❌ Ошибка статуса:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                status: 'error',
                message: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            })
        };
    }
};
