const Twilio = require('twilio');

exports.handler = async function(event, context) {
    // Configurar headers CORS
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Manejar preflight OPTIONS
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // Solo permitir POST
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ 
                success: false, 
                error: 'Método no permitido. Use POST.' 
            })
        };
    }

    try {
        // Obtener credenciales de Twilio de variables de entorno
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;

        if (!accountSid || !authToken) {
            console.error('❌ Twilio credentials not configured');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    success: false,
                    error: 'Twilio credentials not configured in environment variables'
                })
            };
        }

        // Parsear datos de la solicitud
        const { number } = JSON.parse(event.body);

        if (!number) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    success: false,
                    error: 'Número telefónico requerido'
                })
            };
        }

        console.log(`🔍 Twilio Lookup request for: ${number}`);

        // Inicializar cliente Twilio
        const client = new Twilio(accountSid, authToken);

        // Hacer Lookup con Twilio
        // El parámetro 'type: 'carrier'' obtiene información del operador
        // Esto hace un ping al operador para verificar si el número existe
        const lookupData = await client.lookups.v2.phoneNumbers(number)
            .fetch({ fields: 'line_type_intelligence,carrier' });

        console.log('📊 Twilio Lookup response:', {
            number: lookupData.phoneNumber,
            valid: lookupData.valid,
            lineType: lookupData.lineTypeIntelligence?.type,
            carrier: lookupData.carrier?.name,
            country: lookupData.countryCode
        });

        // Determinar estado basado en la respuesta
        let status = 'unknown';
        
        if (!lookupData.valid) {
            status = 'invalid';
        } else if (lookupData.lineTypeIntelligence?.type === 'mobile' || 
                   lookupData.lineTypeIntelligence?.type === 'landline') {
            // Si Twilio devuelve un tipo de línea válido, el número existe
            status = 'active';
        } else if (lookupData.lineTypeIntelligence?.type === 'invalid') {
            status = 'inactive';
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                status: status,
                number: lookupData.phoneNumber,
                valid: lookupData.valid,
                lineType: lookupData.lineTypeIntelligence?.type || 'unknown',
                carrier: lookupData.carrier?.name || 'Desconocido',
                country: lookupData.countryCode || 'N/A',
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('❌ Error en Twilio Lookup:', error);

        let errorMessage = 'Error en la validación';
        let status = 'error';

        // Manejar errores específicos de Twilio
        if (error.code === 20404) {
            errorMessage = 'Número no encontrado o formato inválido';
            status = 'invalid';
        } else if (error.code === 20003) {
            errorMessage = 'Error de autenticación con Twilio';
        } else if (error.code === 21211) {
            errorMessage = 'Número telefónico inválido';
            status = 'invalid';
        } else if (error.status === 404) {
            errorMessage = 'Número no existe';
            status = 'inactive';
        }

        return {
            statusCode: 200, // Devolvemos 200 para que el frontend pueda manejar el error
            headers,
            body: JSON.stringify({
                success: false,
                status: status,
                error: errorMessage,
                twilioError: error.code,
                message: error.message
            })
        };
    }
};
