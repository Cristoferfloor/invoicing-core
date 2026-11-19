import { EmpresaConfigurada } from './modelo';

// Modo compatible: las plantillas actuales leen la empresa con los nombres de
// tb_enterprise y el comprobante con los campos que hoy guarda clientrest.php.

export function empresaCompatible(e: EmpresaConfigurada): Record<string, unknown> {
  return {
    ruc: e.ruc,
    name: e.razonSocial,
    address: e.direccionMatriz,
    environment: String(e.ambiente),
    accounting: e.obligadoContabilidad ? 'SI' : 'NO',
    code_contributor: e.contribuyenteEspecial ?? '',
  };
}

// Lo que clientrest.php::import_documents() agrega al comprobante
// (clientrest.php:748-761).
export function comprobanteCompatible(datos: Record<string, unknown>, claveAcceso: string): Record<string, unknown> {
  const c: Record<string, unknown> = { ...datos };
  if (typeof c.email === 'string') c.email = c.email.split('|').join(';');
  c.estado_sri = 'NO PROCESADO';
  c.agente = '1';
  c.contribuyente = 'CONTRIBUYENTE RÉGIMEN MICROEMPRESAS';
  c.contribuyenteRimpe = 'CONTRIBUYENTE RÉGIMEN RIMPE';
  c.clave_acceso = claveAcceso;
  c.modificado = '';
  c.codigo_autorizacion = '';
  c.numero_autorizacion = '';
  c.fecha_autorizacion = '';
  c.mensaje = '';
  return c;
}
