// Politica de privacidad publica (requisito para publicar la app OAuth de Google, Fase 0).
// Version completa para la revision de la consent screen de Google Cloud.
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Politica de privacidad · PicMyEvent" };

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: "48rem", margin: "0 auto", padding: "2rem", lineHeight: 1.65 }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>Politica de privacidad · PicMyEvent</h1>
      <p style={{ color: "var(--muted)", marginBottom: "1.5rem" }}>
        <strong>Ultima actualizacion:</strong> fecha de publicacion.
      </p>

      <h2 style={{ fontWeight: 600, marginTop: "1.5rem" }}>1. Quienes somos</h2>
      <p>
        PicMyEvent (en adelante, "la aplicacion", "nosotros") es un servicio web que permite a los
        organizadores de eventos (bodas, cumpleaños, eventos escolares o politicos) recoger las fotos
        que sus invitados toman durante el evento, a traves de un codigo QR. Los datos se gestionan
        conforme a esta politica. Para cualquier duda, escribenos a <strong>contacto@picmyevent.app</strong>.
      </p>

      <h2 style={{ fontWeight: 600, marginTop: "1.5rem" }}>2. Que datos recopilamos</h2>
      <p><strong>Organizadores (mediante su cuenta de Google):</strong></p>
      <ul style={{ paddingLeft: "1.25rem", margin: "0.25rem 0" }}>
        <li>Nombre y direccion de correo electronico (datos basicos del perfil de Google).</li>
        <li>La configuracion del evento que usted crea: titulo, nombres de los duenos, mensaje, tema y foto de bienvenida.</li>
        <li>Acceso a la carpeta de Google Drive que usted elige o que la aplicacion crea para su evento, con su autorizacion explicita.</li>
      </ul>
      <p style={{ marginTop: "0.75rem" }}><strong>Invitados (sin crear cuenta):</strong></p>
      <ul style={{ paddingLeft: "1.25rem", margin: "0.25rem 0" }}>
        <li>Las fotos que toman durante el evento, junto con un mensaje opcional, "me gusta" y comentarios.</li>
        <li>Un identificador anonimo (cookie) para asociar sus "me gusta" y comentarios; no almacenamos su nombre, telefono ni correo.</li>
      </ul>

      <h2 style={{ fontWeight: 600, marginTop: "1.5rem" }}>3. Como usamos tus datos</h2>
      <ul style={{ paddingLeft: "1.25rem", margin: "0.25rem 0" }}>
        <li>Para permitir a los invitados tomar y compartir fotos del evento en un feed en vivo.</li>
        <li>Para guardar las fotos en la carpeta de Google Drive del organizador, tal como el la configuro.</li>
        <li>Para que el organizador administre su evento (editar configuracion, moderar fotos y comentarios, cerrar o eliminar el evento).</li>
        <li>Para mantener el servicio seguro (limitacion de uso, deteccion de abuso y soporte).</li>
      </ul>
      <p>
        No utilizamos tus datos para publicidad, no vendemos datos personales a terceros y no los
        usamos para tomar decisiones automatizadas que te afecten.
      </p>

      <h2 style={{ fontWeight: 600, marginTop: "1.5rem" }}>4. Acceso a tus datos de Google (Drive)</h2>
      <p>
        Cuando un organizador conecta su cuenta de Google, la aplicacion solicita unicamente el alcance
        <strong> drive.file</strong> (https://www.googleapis.com/auth/drive.file). Este alcance nos permite
        <strong> crear y gestionar SOLO los archivos que la propia aplicacion crea</strong> (la carpeta del
        evento y las fotos subidas a traves de la aplicacion). No podemos leer, modificar ni eliminar
        otros archivos de tu Google Drive.
      </p>
      <p>
        La aplicacion crea la carpeta del evento en tu Drive; las fotos de los invitados se guardan en esa
        carpeta. Las fotos que los invitados suben a traves de la aplicacion pertenecen a la cuenta de
        Google que conecto el evento y cuentan contra su almacenamiento de Drive.
      </p>
      <p>
        Tu acceso se puede revocar en cualquier momento desde
        <strong> tu cuenta de Google &gt; Datos y privacidad &gt; Apps de terceros</strong>. Tambien puedes
        desconectar el Drive del evento desde el panel de administracion de PicMyEvent.
      </p>

      <h2 style={{ fontWeight: 600, marginTop: "1.5rem" }}>5. Almacenamiento, seguridad y retencion</h2>
      <ul style={{ paddingLeft: "1.25rem", margin: "0.25rem 0" }}>
        <li>Las fotos originales se almacenan en la carpeta de Google Drive del organizador (su cuenta, su control).</li>
        <li>Los mensajes, "me gusta", comentarios y la configuracion del evento se almacenan en nuestra base de datos (Supabase).</li>
        <li>Los tokens de acceso a Google Drive se guardan <strong>cifrados</strong> (AES-256-GCM) y solo se usan para subir o eliminar fotos de la carpeta del evento; nunca se exponen al navegador de los invitados.</li>
        <li>Los datos del evento se conservan mientras el evento exista. Cuando el organizador elimina su evento, eliminamos la configuracion, mensajes, "me gusta" y comentarios; las fotos permanecen en su Drive y quedan bajo su control.</li>
      </ul>

      <h2 style={{ fontWeight: 600, marginTop: "1.5rem" }}>6. Con quien compartimos datos</h2>
      <ul style={{ paddingLeft: "1.25rem", margin: "0.25rem 0" }}>
        <li><strong>Google (Drive y OAuth):</strong> para autenticar organizadores y almacenar las fotos en la carpeta elegida.</li>
        <li><strong>Supabase:</strong> proveedor de nuestra base de datos, autenticacion y almacenamiento de miniaturas.</li>
        <li><strong>Vercel:</strong> proveedor de alojamiento (hosting) de la aplicacion.</li>
      </ul>
      <p>
        No compartimos datos personales con ningun otro tercero, salvo obligacion legal o con tu consentimiento explicito.
      </p>

      <h2 style={{ fontWeight: 600, marginTop: "1.5rem" }}>7. Tus derechos</h2>
      <p>
        Dependiendo de tu jurisdiccion (por ejemplo, el RGPD en la Union Europea), puedes solicitar el
        acceso, la rectificacion, la portabilidad o el borrado de tus datos, asi como oponerte a su
        tratamiento. Para ejercer estos derechos, escribenos a <strong>contacto@picmyevent.app</strong>.
        Los organizadores pueden, ademas, borrar fotos, cerrar o eliminar su evento directamente desde el panel.
      </p>

      <h2 style={{ fontWeight: 600, marginTop: "1.5rem" }}>8. Menores de edad</h2>
      <p>
        La aplicacion no esta dirigida a menores de 13 años (o la edad minima que aplique en tu pais).
        Como los invitados no crean cuentas, recomendamos a los organizadores obtener el consentimiento
        correspondiente antes de tomar o publicar fotos de menores en sus eventos. El organizador puede
        borrar cualquier foto desde su panel de administracion.
      </p>

      <h2 style={{ fontWeight: 600, marginTop: "1.5rem" }}>9. Cambios en esta politica</h2>
      <p>
        Podemos actualizar esta politica periodicamente. Publicaremos la version vigente en esta misma
        direccion con su fecha de actualizacion. Los cambios sustanciales se comunicaran a los
        organizadores por correo.
      </p>

      <h2 style={{ fontWeight: 600, marginTop: "1.5rem" }}>10. Contacto</h2>
      <p>
        PicMyEvent · <strong>contacto@picmyevent.app</strong> · Ultima actualizacion: fecha de publicacion.
      </p>
    </main>
  );
}
