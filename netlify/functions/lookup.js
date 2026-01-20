const Twilio = require('twilio');

exports.handler = async function(event, context) {
    console.log('🔍 ========== LOOKUP FUNCTION CALLED ==========');
    console.log('HTTP Method:', event.httpMethod);
    console.log('Headers:', event.headers);
    console.log('Body:', event.body);
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Manejar preflight OPTIONS
    if (event.httpMethod === 'OPTIONS') {
        console.log('🔄 Handling OPTIONS preflight');
        return { statusCode: 200, headers, body: '' };
    }

    // Solo permitir POST
    if (event.httpMethod !== 'POST') {
        console.log('❌ Method not allowed:', event.httpMethod);
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
        // Obtener credenciales de Twilio
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;

        console.log('🔐 Twilio Credentials Check:');
        console.log('- Account SID exists:', !!accountSid);
        console.log('- Auth Token exists:', !!authToken);
        console.log('- Account SID starts with AC?:', accountSid?.startsWith('AC'));
        console.log('- Auth Token length:', authToken?.length);

        if (!accountSid || !authToken) {
            console.error('❌ Twilio credentials missing');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    success: false,
                    error: 'Twilio credentials not configured in environment variables',
                    details: 'Please add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to Netlify environment variables'
                })
            };
        }

        // Parsear datos
        let requestData;
        try {
            requestData = JSON.parse(event.body);
            console.log('📦 Parsed request data:', requestData);
        } catch (parseError) {
            console.error('❌ Error parsing JSON:', parseError);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    success: false,
                    error: 'Invalid JSON format in request body',
                    details: parseError.message
                })
            };
        }

        const { number } = requestData;

        if (!number) {
            console.log('❌ No number provided');
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    success: false,
                    error: 'Número telefónico requerido',
                    details: 'El campo "number" es obligatorio en el cuerpo de la solicitud'
                })
            };
        }

        console.log(`🔍 Processing lookup for: ${number}`);

        // Inicializar cliente Twilio
        const client = new Twilio(accountSid, authToken);
        
        // Limpiar número
        const cleanNumber = number.replace(/\s+/g, '');
        console.log(`🔧 Cleaned number: ${cleanNumber}`);

        // ENFOQUE 1: Lookup V1 (carrier)
        try {
            console.log('📡 Trying Lookup V1 (carrier)...');
            const result = await client.lookups
                .phoneNumbers(cleanNumber)
                .fetch({ type: ['carrier'] });
            
            console.log('✅ Lookup V1 Success!');
            console.log('Result:', {
                phoneNumber: result.phoneNumber,
                nationalFormat: result.nationalFormat,
                carrier: result.carrier,
                countryCode: result.countryCode,
                carrierErrorCode: result.carrierErrorCode
            });

            // Determinar estado basado en carrier
            let status = 'unknown';
            let message = 'Estado desconocido';
            let valid = true;
            
            if (result.carrier && result.carrier.name) {
                status = 'active';
                message = `✅ ACTIVO - Operador: ${result.carrier.name}`;
                if (result.carrier.type) {
                    message += ` (${result.carrier.type})`;
                }
            } else if (result.carrierErrorCode) {
                status = 'inactive';
                valid = false;
                message = `❌ INACTIVO - Error código: ${result.carrierErrorCode}`;
            } else {
                status = 'inactive';
                valid = false;
                message = '❌ INACTIVO - No se encontró información del operador';
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    status: status,
                    number: result.phoneNumber,
                    valid: valid,
                    message: message,
                    carrier: result.carrier?.name || 'Desconocido',
                    carrierType: result.carrier?.type || 'unknown',
                    country: result.countryCode || 'N/A',
                    carrierErrorCode: result.carrierErrorCode || null,
                    method: 'lookup_v1_carrier',
                    timestamp: new Date().toISOString()
                })
            };

        } catch (v1Error) {
            console.log('⚠️ Lookup V1 failed:', v1Error.message);
            
            // ENFOQUE 2: Lookup V2 (line type intelligence)
            try {
                console.log('📡 Trying Lookup V2 (line_type_intelligence)...');
                const v2Result = await client.lookups.v2.phoneNumbers(cleanNumber)
                    .fetch({ 
                        fields: 'line_type_intelligence,caller_name,sim_swap' 
                    });
                
                console.log('✅ Lookup V2 Success!');
                console.log('V2 Result:', {
                    phoneNumber: v2Result.phoneNumber,
                    valid: v2Result.valid,
                    lineType: v2Result.lineTypeIntelligence,
                    callerName: v2Result.callerName
                });

                let status = 'unknown';
                let message = 'Estado desconocido';
                let valid = v2Result.valid !== false;
                
                if (v2Result.lineTypeIntelligence) {
                    const lineType = v2Result.lineTypeIntelligence.type;
                    const lineTypeName = v2Result.lineTypeIntelligence.type || 'unknown';
                    
                    if (lineTypeName === 'mobile' || lineTypeName === 'landline' || lineTypeName === 'voip') {
                        status = 'active';
                        message = `✅ ACTIVO - Tipo: ${lineTypeName}`;
                    } else if (lineTypeName === 'invalid' || lineTypeName === 'unknown') {
                        status = 'inactive';
                        message = `❌ INACTIVO - Tipo: ${lineTypeName}`;
                        valid = false;
                    } else {
                        status = lineTypeName === 'fixedLine' ? 'active' : 'unknown';
                        message = `ℹ️ ${lineTypeName.toUpperCase()} - Tipo: ${lineTypeName}`;
                    }
                } else {
                    status = 'inactive';
                    message = '❌ INACTIVO - No hay información de tipo de línea';
                    valid = false;
                }

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        success: true,
                        status: status,
                        number: v2Result.phoneNumber,
                        valid: valid,
                        message: message,
                        lineType: v2Result.lineTypeIntelligence?.type || 'unknown',
                        lineTypeName: v2Result.lineTypeIntelligence?.type_name || 'unknown',
                        callerName: v2Result.callerName?.caller_name || 'N/A',
                        country: v2Result.countryCode || 'N/A',
                        method: 'lookup_v2_line_type',
                        timestamp: new Date().toISOString()
                    })
                };

            } catch (v2Error) {
                console.error('❌ Lookup V2 also failed');
                console.error('V2 Error details:', {
                    code: v2Error.code,
                    status: v2Error.status,
                    message: v2Error.message,
                    moreInfo: v2Error.moreInfo
                });

                // Analizar el error para dar mejor información
                let errorMessage = v2Error.message;
                let errorCode = v2Error.code;
                let userMessage = 'Error en la validación';
                
                // Mensajes más amigables para errores comunes
                if (errorCode === 20404) {
                    userMessage = 'Número no encontrado en Twilio';
                } else if (errorCode === 20003) {
                    userMessage = 'Error de autenticación de Twilio';
                } else if (errorCode === 60605) {
                    userMessage = 'Número no válido para el país';
                }

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        success: false,
                        status: 'error',
                        error: userMessage,
                        details: errorMessage,
                        code: errorCode,
                        method: 'lookup_failed',
                        timestamp: new Date().toISOString(),
                        debug: {
                            v1Error: v1Error.message,
                            v2Error: v2Error.message
                        }
                    })
                };
            }
        }

    } catch (error) {
        console.error('❌ UNEXPECTED ERROR in handler:', error);
        console.error('Stack:', error.stack);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: false,
                status: 'error',
                error: 'Error interno del servidor',
                details: error.message,
                code: error.code || 'UNKNOWN',
                timestamp: new Date().toISOString()
            })
        };
    }
};
