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

        // Formatear número (eliminar espacios y caracteres especiales)
        const cleanNumber = number.replace(/\s+/g, '');
        
        // Hacer Lookup con Twilio - FORMA CORRECTA SEGÚN DOCUMENTACIÓN
        // https://www.twilio.com/docs/lookup/api
        const lookupResult = await client.lookups.v2.phoneNumbers(cleanNumber)
            .fetch({
                fields: 'line_type_intelligence,carrier,country_code'
            });

        console.log('📊 Twilio Lookup response:', {
            phoneNumber: lookupResult.phoneNumber,
            valid: lookupResult.valid,
            lineType: lookupResult.lineTypeIntelligence,
            carrier: lookupResult.carrier,
            countryCode: lookupResult.countryCode
        });

        // Determinar estado basado en la respuesta
        let status = 'unknown';
        let message = 'Estado desconocido';
        let carrierName = 'Desconocido';
        
        // Verificar si el número es válido
        if (lookupResult.valid === false) {
            status = 'invalid';
            message = '❌ NÚMERO INVÁLIDO - Formato incorrecto o no existe';
        } else {
            // Analizar tipo de línea
            if (lookupResult.lineTypeIntelligence) {
                const lineType = lookupResult.lineTypeIntelligence.type;
                
                switch(lineType) {
                    case 'mobile':
                        status = 'active';
                        message = '✅ ACTIVO - Línea móvil';
                        break;
                    case 'landline':
                        status = 'active';
                        message = '✅ ACTIVO - Línea fija';
                        break;
                    case 'voip':
                        status = 'active';
                        message = '✅ ACTIVO - Línea VoIP';
                        break;
                    case 'invalid':
                        status = 'inactive';
                        message = '❌ INACTIVO - Línea no válida';
                        break;
                    case 'other':
                        status = 'active';
                        message = '✅ ACTIVO - Otro tipo de línea';
                        break;
                    default:
                        status = 'unknown';
                        message = '⚠️ DESCONOCIDO - Tipo de línea no determinado';
                }
            } else {
                // Si no hay información de tipo de línea pero el número es válido
                status = 'active';
                message = '✅ ACTIVO - Número válido (sin detalles de línea)';
            }
            
            // Obtener información del operador
            if (lookupResult.carrier && lookupResult.carrier.name) {
                carrierName = lookupResult.carrier.name;
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                status: status,
                number: lookupResult.phoneNumber,
                valid: lookupResult.valid,
                message: message,
                carrier: carrierName,
                country: lookupResult.countryCode || 'N/A',
                lineType: lookupResult.lineTypeIntelligence?.type || 'unknown',
                carrierFull: lookupResult.carrier || null,
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('❌ Error en Twilio Lookup:', error);
        console.error('Detalles del error:', {
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
            errorMessage = 'Recurso no encontrado';
            status = 'not_found';
            details = 'El número no existe en la base de datos de Twilio';
        } else if (error.code === 20003) {
            errorMessage = 'Error de autenticación con Twilio';
            details = 'Verifica que TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN sean correctos';
        } else if (error.code === 21211) {
            errorMessage = 'Número telefónico inválido';
            status = 'invalid';
            details = 'Formato incorrecto. Usa formato internacional: +502XXXXXXXX';
        } else if (error.code === 20001) {
            errorMessage = 'Cuenta desactivada o sin saldo';
            details = 'Tu cuenta Twilio necesita saldo para usar Lookup';
        } else if (error.code === 60043) {
            errorMessage = 'Límite de requests excedido';
            status = 'rate_limited';
            details = 'Demasiadas consultas en poco tiempo';
        } else if (error.status === 400) {
            errorMessage = 'Solicitud inválida';
            details = error.message || 'Parámetros incorrectos en la solicitud';
        } else if (error.status === 404) {
            errorMessage = 'Número no encontrado';
            status = 'not_found';
            details = 'El operador no tiene información de este número';
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
                timestamp: new Date().toISOString()
            })
        };
    }
};
