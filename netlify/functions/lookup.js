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

        console.log(`🔍 Twilio Lookup V2 request for: ${number}`);

        // Inicializar cliente Twilio
        const client = new Twilio(accountSid, authToken);

        // ¡CORRECCIÓN IMPORTANTE! - Formato correcto para Lookup V2
        // Opción 1: Sin parámetros (solo validación básica)
        const lookupData = await client.lookups.v2.phoneNumbers(number)
            .fetch();
        
        console.log('📊 Twilio Lookup V2 RAW response:', JSON.stringify(lookupData, null, 2));

        // Analizar la respuesta
        let status = 'unknown';
        let carrier = 'Desconocido';
        let country = 'N/A';
        let lineType = 'unknown';
        
        // Verificar si es válido
        if (lookupData.valid === false) {
            status = 'invalid';
        } else {
            // Intentar determinar si está activo
            if (lookupData.lineTypeIntelligence) {
                lineType = lookupData.lineTypeIntelligence.type || 'unknown';
                
                if (lineType === 'mobile' || lineType === 'landline') {
                    status = 'active';
                } else if (lineType === 'invalid') {
                    status = 'inactive';
                } else if (lineType === 'voip' || lineType === 'toll_free') {
                    status = 'active'; // Considerar como activo
                }
            }
            
            // Obtener información del carrier
            if (lookupData.carrier) {
                carrier = lookupData.carrier.name || 'Desconocido';
            }
            
            // Obtener país
            if (lookupData.countryCode) {
                country = lookupData.countryCode;
            }
            
            // Si no se pudo determinar pero es válido, asumir activo
            if (status === 'unknown' && lookupData.valid === true) {
                status = 'active';
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                status: status,
                number: lookupData.phoneNumber,
                valid: lookupData.valid,
                lineType: lineType,
                carrier: carrier,
                country: country,
                timestamp: new Date().toISOString(),
                // Información adicional para debugging
                rawData: {
                    phoneNumber: lookupData.phoneNumber,
                    nationalFormat: lookupData.nationalFormat,
                    countryCode: lookupData.countryCode,
                    valid: lookupData.valid,
                    lineTypeIntelligence: lookupData.lineTypeIntelligence,
                    carrier: lookupData.carrier
                }
            })
        };

    } catch (error) {
        console.error('❌ Error en Twilio Lookup V2:', error);
        
        // Mostrar más detalles del error
        console.error('Error details:', {
            code: error.code,
            status: error.status,
            message: error.message,
            moreInfo: error.moreInfo
        });

        let errorMessage = 'Error en la validación';
        let status = 'error';
        let details = error.message;

        // Manejar errores específicos de Twilio
        if (error.code === 20404) {
            errorMessage = 'Número no encontrado';
            status = 'inactive';
        } else if (error.code === 21211) {
            errorMessage = 'Número inválido';
            status = 'invalid';
        } else if (error.code === 20003) {
            errorMessage = 'Error de autenticación con Twilio';
        } else if (error.code === 21450) {
            errorMessage = 'Lookup no disponible para este país';
            status = 'unsupported';
        } else if (error.code === 21612) {
            errorMessage = 'No se puede validar este tipo de número';
            status = 'invalid';
        } else if (error.status === 400) {
            errorMessage = 'Parámetros inválidos en la solicitud';
            details = `Error 400: ${error.message}`;
        } else if (error.status === 401) {
            errorMessage = 'No autorizado - verifica tus credenciales';
        } else if (error.status === 404) {
            errorMessage = 'Recurso no encontrado';
            status = 'inactive';
        }

        return {
            statusCode: 200, // Devolvemos 200 para que el frontend pueda manejar el error
            headers,
            body: JSON.stringify({
                success: false,
                status: status,
                error: errorMessage,
                details: details,
                code: error.code,
                moreInfo: error.moreInfo,
                timestamp: new Date().toISOString()
            })
        };
    }
};
