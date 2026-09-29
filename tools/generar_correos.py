"""Genera las plantillas HTML de EmailJS (emails/*.html) con el diseño de Amarë.

Uso:  python tools/generar_correos.py
Luego se pega cada archivo en EmailJS → Email Templates → (template) → Content → Code Editor.
Las variables {{...}} las envía el servidor de reservas (apps-script/Codigo.gs).
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERIF = "'Playfair Display',Georgia,'Times New Roman',serif"
SANS = "Montserrat,'Helvetica Neue',Arial,sans-serif"


def fila(etiqueta, valor, ultima=False, destacado=False):
    borde = '' if ultima else 'border-bottom:1px solid #F0EBE3;'
    estilo_valor = f"font-family:{SERIF};font-size:17px;" if destacado else 'font-size:14px;'
    return (f'<tr><td style="padding:13px 20px;{borde}font-size:11px;letter-spacing:2px;text-transform:uppercase;'
            f'color:#8A7A63;width:42%;vertical-align:top;">{etiqueta}</td>'
            f'<td style="padding:13px 20px;{borde}{estilo_valor}color:#0B0B0B;">{valor}</td></tr>')


def tarjeta(titulo_chico, titulo, filas, cierre=None):
    h = (f'<tr><td style="padding:22px 44px 10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
         f'style="border:1px solid #E9E3D9;background:#FFFFFF;font-family:{SANS};">'
         f'<tr><td colspan="2" style="background:#0B0B0B;padding:16px 20px;">'
         f'<div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#B5A48A;">{titulo_chico}</div>'
         f'<div style="font-family:{SERIF};font-size:22px;color:#F5F3EF;padding-top:4px;">{titulo}</div></td></tr>')
    for i, f in enumerate(filas):
        h += fila(*f, ultima=(i == len(filas) - 1 and not cierre))
    if cierre:
        h += (f'<tr><td colspan="2" align="center" style="background:#E9E3D9;padding:22px 20px;">'
              f'<div style="font-family:{SERIF};font-size:22px;font-style:italic;color:#0B0B0B;">{cierre[0]}</div>'
              f'<div style="font-size:13px;color:#5F5850;padding-top:6px;">{cierre[1]}</div></td></tr>')
    return h + '</table></td></tr>'


def recuadro(texto):
    return (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;"><tr>'
            f'<td style="border-left:3px solid #0B0B0B;background:#F5F3EF;padding:14px 18px;font-size:14px;line-height:1.6;color:#0B0B0B;">{texto}</td>'
            f'</tr></table>')


def boton(texto, url, claro=False):
    fondo, color, borde = ('#FFFFFF', '#0B0B0B', '1px solid #0B0B0B') if claro else ('#0B0B0B', '#F5F3EF', '1px solid #0B0B0B')
    return (f'<td align="center" style="background:{fondo};border:{borde};padding:0;">'
            f'<a href="{url}" target="_blank" style="display:inline-block;padding:15px 24px;font-family:{SANS};font-size:11px;'
            f'letter-spacing:3px;text-transform:uppercase;color:{color};text-decoration:none;">{texto}</a></td>')


def botones(*lista):
    celdas = '<td style="width:10px"></td>'.join(boton(*b) for b in lista)
    return (f'<tr><td align="center" style="padding:24px 44px 36px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0">'
            f'<tr>{celdas}</tr></table></td></tr>')


def nota(texto):
    return (f'<tr><td style="padding:14px 44px 6px;font-family:{SANS};font-size:12px;line-height:1.6;color:#8A7A63;">{texto}</td></tr>')


def pagina(titulo, preheader, eyebrow, saludo, parrafos, bloques, variables):
    cuerpo = ''.join(f'<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#5F5850;">{p}</p>' if not p.startswith('<table') else p
                     for p in parrafos)
    return f'''<!DOCTYPE html>
<!--
  Plantilla EmailJS: {titulo}
  Pegar TODO este archivo en EmailJS → Email Templates → Content → Code Editor.
  Variables: {variables}
  Generado por tools/generar_correos.py (no editar a mano; editar el script y regenerar).
-->
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>{titulo}</title>
</head>
<body style="margin:0;padding:0;background:#F5F3EF;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#F5F3EF;">{preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F3EF;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FBFAF7;border:1px solid #E9E3D9;">
          <tr>
            <td align="center" style="background:#0B0B0B;padding:34px 24px 30px;">
              <div style="font-family:{SERIF};font-size:34px;letter-spacing:6px;color:#F5F3EF;line-height:1;">AMARË</div>
              <div style="font-family:{SANS};font-size:10px;letter-spacing:5px;color:#B5A48A;text-transform:uppercase;padding-top:10px;">Beauty Center</div>
            </td>
          </tr>
          <tr>
            <td style="padding:0;line-height:0;">
              <img src="https://amarecr.com/assets/email/cabecera.jpg" width="600" alt="Amarë Beauty Center" style="display:block;width:100%;max-width:600px;height:auto;border:0;">
            </td>
          </tr>
          <tr>
            <td style="padding:40px 44px 8px;font-family:{SANS};">
              <div style="font-size:10px;letter-spacing:4px;text-transform:uppercase;color:#8A7A63;">{eyebrow}</div>
              <h1 style="margin:14px 0 18px;font-family:{SERIF};font-weight:normal;font-size:30px;line-height:1.2;color:#0B0B0B;">{saludo}</h1>
              {cuerpo}
            </td>
          </tr>
          {''.join(bloques)}
          <tr>
            <td align="center" style="background:#0B0B0B;padding:30px 24px;font-family:{SANS};">
              <div style="font-family:{SERIF};font-style:italic;font-size:15px;color:#F5F3EF;line-height:1.5;">La belleza no comienza en el espejo,<br>sino en cómo nos sentimos.</div>
              <div style="font-size:12px;color:#B5A48A;padding-top:16px;line-height:1.8;">
                Calle 42, San José, Costa Rica · Martes a sábado, 9:00 a.m. – 6:00 p.m.<br>
                <a href="tel:+50688073849" style="color:#B5A48A;text-decoration:none;">+506 8807-3849</a> ·
                <a href="https://amarecr.com" style="color:#B5A48A;text-decoration:none;">amarecr.com</a> ·
                <a href="https://www.instagram.com/amare_beauty_center" style="color:#B5A48A;text-decoration:none;">Instagram</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
'''


WHATSAPP = 'https://api.whatsapp.com/send?phone=50688073849&amp;text=Hola%20Amar%C3%AB!%20Les%20escribo%20por%20mi%20reserva.'
POLITICA = ('El depósito se descuenta del total del servicio. Las cancelaciones o reagendamientos con menos de 72 horas de '
            'anticipación no tienen reembolso, y la inasistencia sin aviso implica la pérdida del depósito.')

PLANTILLAS = {
    'pago-confirmado.html': dict(
        titulo='Depósito validado', asunto='Depósito validado · {{servicio}} · Amarë Beauty Center',
        preheader='Validamos su depósito, {{nombre}}. En breve le confirmamos la hora de su cita.',
        eyebrow='Pago validado', saludo='Hola {{nombre}}, <em style="color:#8A7A63;">¡su depósito fue validado!</em>',
        parrafos=['Recibimos y validamos su depósito de <strong style="color:#0B0B0B;">{{deposito}}</strong>. '
                  'Nuestro equipo está organizando la agenda y en breve le enviaremos la confirmación con la hora exacta de su cita.'],
        bloques=[tarjeta('Su reserva', '{{servicio}}', [('Categoría', '{{categoria}}'), ('Largo de cabello', '{{largo}}'),
                 ('Fecha solicitada', '{{fecha}} · {{franja}}'), ('Depósito', '{{deposito}}')],
                 ('¡Gracias!', 'Muy pronto le confirmamos su espacio.')),
                 botones(('¿Dudas? Escríbanos', WHATSAPP))],
        variables='{{nombre}} {{servicio}} {{categoria}} {{largo}} {{fecha}} {{franja}} {{deposito}}'),

    'pago-rechazado.html': dict(
        titulo='No pudimos validar su pago', asunto='No pudimos validar su pago · Amarë Beauty Center',
        preheader='Necesitamos su ayuda para validar el depósito de su reserva.',
        eyebrow='Pago no validado', saludo='Hola {{nombre}}, <em style="color:#8A7A63;">necesitamos su ayuda</em>',
        parrafos=['No pudimos validar el comprobante de su reserva de <strong style="color:#0B0B0B;">{{servicio}}</strong> '
                  'para el {{fecha}}.',
                  recuadro('<strong>Motivo:</strong> {{motivo}}'),
                  'Por esta razón liberamos el espacio. Si fue un error, escríbanos por WhatsApp con el comprobante correcto '
                  'y con gusto le ayudamos a reagendar.'],
        bloques=[botones(('Escribir por WhatsApp', WHATSAPP))],
        variables='{{nombre}} {{servicio}} {{fecha}} {{motivo}}'),

    'cita-confirmada.html': dict(
        titulo='Cita confirmada', asunto='¡Su cita está confirmada, {{nombre}}! · Amarë Beauty Center',
        preheader='Su cita quedó agendada: {{fecha_hora}}. ¡La esperamos!',
        eyebrow='Cita confirmada', saludo='Hola {{nombre}}, <em style="color:#8A7A63;">¡estamos emocionados de atenderle!</em>',
        parrafos=['Su cita quedó confirmada y ya tiene su espacio reservado en nuestra agenda. Estos son los detalles:'],
        bloques=[tarjeta('Su cita', '{{servicio}}', [('Fecha y hora', '{{fecha_hora}}'), ('Duración estimada', '{{duracion}}'),
                 ('Largo de cabello', '{{largo}}'), ('Depósito', '{{deposito}}'), ('Dirección', '{{direccion}}'),
                 ('Cómo llegar', '{{senales}}')], ('¡La esperamos!', 'Llegue unos minutos antes para comenzar a tiempo.')),
                 botones(('Agregar a mi calendario', '{{calendario_url}}'), ('Cómo llegar', '{{waze}}', True)),
                 nota(POLITICA)],
        variables='{{nombre}} {{servicio}} {{fecha_hora}} {{duracion}} {{largo}} {{deposito}} {{direccion}} {{senales}} {{calendario_url}} {{waze}}'),

    'dia-saturado.html': dict(
        titulo='Coordinemos otra fecha', asunto='Coordinemos otra fecha para su cita · Amarë Beauty Center',
        preheader='El día que eligió se llenó. Le escribiremos para agendar otra fecha.',
        eyebrow='Buscando su espacio', saludo='Hola {{nombre}}, <em style="color:#8A7A63;">coordinemos otra fecha</em>',
        parrafos=['Gracias por elegirnos. El <strong style="color:#0B0B0B;">{{fecha}}</strong> tuvimos una alta demanda y ese día '
                  'quedó completo.',
                  'Su depósito está seguro. Le escribiremos por WhatsApp al <strong style="color:#0B0B0B;">{{celular}}</strong> '
                  'para agendar la fecha que mejor le convenga. Si prefiere, puede escribirnos primero.'],
        bloques=[tarjeta('Su reserva', '{{servicio}}', [('Fecha solicitada', '{{fecha}} · {{franja}}'), ('Depósito', '{{deposito}}')]),
                 botones(('Escribir por WhatsApp', WHATSAPP))],
        variables='{{nombre}} {{servicio}} {{fecha}} {{franja}} {{deposito}} {{celular}}'),

    'recordatorio.html': dict(
        titulo='Recordatorio de su cita', asunto='Recordatorio: su cita en Amarë es mañana',
        preheader='Le esperamos: {{fecha_hora}}.',
        eyebrow='Recordatorio', saludo='Hola {{nombre}}, <em style="color:#8A7A63;">¡mañana es su cita!</em>',
        parrafos=['Le recordamos que mañana tiene su cita en Amarë Beauty Center. Estamos preparando todo para atenderle.'],
        bloques=[tarjeta('Su cita', '{{servicio}}', [('Fecha y hora', '{{fecha_hora}}'), ('Duración estimada', '{{duracion}}'),
                 ('Dirección', '{{direccion}}'), ('Cómo llegar', '{{senales}}')], ('¡Nos vemos pronto!', 'Llegue unos minutos antes, por favor.')),
                 botones(('Abrir en Waze', '{{waze}}'), ('Google Maps', '{{maps}}', True)),
                 nota('Si necesita reagendar, escríbanos por WhatsApp al +506 8807-3849. ' + POLITICA)],
        variables='{{nombre}} {{servicio}} {{fecha_hora}} {{duracion}} {{direccion}} {{senales}} {{waze}} {{maps}}'),
}


def main():
    salida = ROOT / 'emails'
    for nombre, p in PLANTILLAS.items():
        html = pagina(p['titulo'], p['preheader'], p['eyebrow'], p['saludo'], p['parrafos'], p['bloques'], p['variables'])
        (salida / nombre).write_text(html, encoding='utf-8')
        print(f"{nombre:24} asunto: {p['asunto']}")


if __name__ == '__main__':
    main()
