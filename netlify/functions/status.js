const admin = require('firebase-admin');

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
    };
    
    try {
        console.log('📊 === ЗАПРОС СТАТУСА СИСТЕМЫ ===');
        
        // Проверяем переменные окружения
        const privateKey = process.env.FIREBASE_PRIVATE_KEY;
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
        
        console.log('🔍 Проверка environment variables:');
        console.log('- FIREBASE_PRIVATE_KEY существует:', !!privateKey);
        console.log('- FIREBASE_CLIENT_EMAIL существует:', !!clientEmail);
        console.log('- FIREBASE_CLIENT_EMAIL значение:', clientEmail);
        
        if (privateKey) {
            console.log('- Private key длина:', privateKey.length);
            console.log('- Private key начало:', privateKey.substring(0, 50));
            console.log('- Private key содержит BEGIN:', privateKey.includes('BEGIN PRIVATE KEY'));
            console.log('- Private key содержит END:', privateKey.includes('END PRIVATE KEY'));
        }
        
        if (!privateKey || !clientEmail) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    status: 'error',
                    message: 'Environment variables missing',
                    debug: {
                        hasPrivateKey: !!privateKey,
                        hasClientEmail: !!clientEmail,
                        clientEmail: clientEmail || 'not set'
                    },
                    timestamp: new Date().toISOString()
                })
            };
        }
        
        // Проверяем инициализацию Firebase
        console.log('🔥 Firebase apps count:', admin.apps.length);
        
        let firebaseInitialized = false;
        
        if (admin.apps.length === 0) {
            console.log('🔄 Инициализируем Firebase...');
            
            try {
                // Обрабатываем приватный ключ
                let cleanPrivateKey = privateKey.replace(/\\n/g, '\n');
                
                console.log('🔑 Processed key length:', cleanPrivateKey.length);
                console.log('🔑 Key starts with:', cleanPrivateKey.substring(0, 30));
                
                admin.initializeApp({
                    credential: admin.credential.cert({
                        projectId: "pulse-fm-84a48",
                        privateKey: cleanPrivateKey,
                        clientEmail: clientEmail,
                    })
                });
                
                firebaseInitialized = true;
                console.log('✅ Firebase инициализирован успешно');
                
            } catch (initError) {
                console.error('❌ Ошибка инициализации Firebase:', initError);
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({
                        status: 'error',
                        message: 'Firebase initialization error',
                        error: initError.message,
                        debug: {
                            privateKeyLength: privateKey.length,
                            clientEmail: clientEmail,
                            privateKeyStart: privateKey.substring(0, 30)
                        },
                        timestamp: new Date().toISOString()
                    })
                };
            }
        } else {
            firebaseInitialized = true;
            console.log('✅ Firebase уже инициализирован');
        }
        
        // Тестируем подключение к Firestore
        console.log('🧪 Тестируем Firestore...');
        
        let firestoreWorks = false;
        let stats = {};
        let recentTracks = [];
        
        try {
            const db = admin.firestore();
            
            // Простой тест подключения
            const testQuery = await db.collection('new_tracks').limit(1).get();
            console.log('✅ Firestore подключение работает');
            firestoreWorks = true;
            
            // Получаем статистику
            const [newTracksSnap, knownTracksSnap] = await Promise.all([
                db.collection('new_tracks').count().get().catch(() => ({ data: () => ({ count: 0 }) })),
                db.collection('known_tracks').count().get().catch(() => ({ data: () => ({ count: 0 }) }))
            ]);
            
            stats = {
                totalNewTracks: newTracksSnap.data().count,
                totalKnownTracks: knownTracksSnap.data().count
            };
            
            // Получаем последние треки
            const recentTracksSnap = await db.collection('new_tracks')
                .orderBy('addedToLibrary', 'desc')
                .limit(5)
                .get();
            
            recentTracks = recentTracksSnap.docs.map(doc => {
                const data = doc.data();
                return {
                    artist: data.artist,
                    title: data.title,
                    addedAt: data.addedToLibrary?.toDate()?.toISOString()
                };
            });
            
        } catch (firestoreError) {
            console.error('❌ Ошибка Firestore:', firestoreError);
            firestoreWorks = false;
        }
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                status: firestoreWorks ? 'ok' : 'partial',
                timestamp: new Date().toISOString(),
                firebase: {
                    initialized: firebaseInitialized,
                    appsCount: admin.apps.length,
                    projectId: 'pulse-fm-84a48'
                },
                firestore: {
                    connected: firestoreWorks
                },
                stats: stats,
                recentTracks: recentTracks,
                environment: {
                    hasPrivateKey: !!privateKey,
                    hasClientEmail: !!clientEmail,
                    clientEmail: clientEmail,
                    netlifyFunction: true,
                    nodeVersion: process.version
                },
                debug: {
                    privateKeyLength: privateKey ? privateKey.length : 0,
                    privateKeyHasNewlines: privateKey ? privateKey.includes('\n') : false,
                    privateKeyHasBegin: privateKey ? privateKey.includes('BEGIN PRIVATE KEY') : false
                },
                version: '1.1.0'
            })
        };
        
    } catch (error) {
        console.error('❌ Общая ошибка статуса:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                status: 'error',
                message: 'System error',
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            })
        };
    }
};
