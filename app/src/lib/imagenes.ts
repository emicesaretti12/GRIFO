import { supabase } from './supabase'

const BUCKET = 'canillas'
const MAX_LADO = 900
const MAX_BYTES = 3 * 1024 * 1024

/**
 * Sube el logo/foto de una cerveza a Supabase Storage.
 *
 * Antes de subir la redimensiona en el navegador: una foto de celular son 4 MB
 * y 4000 px de ancho, y la pantalla de la canilla la muestra a 128. Subir el
 * original sería tirar ancho de banda del bar y hacer que la pantalla tarde en
 * pintar la primera vez.
 */
export async function subirImagenCerveza(grifoId: number, archivo: File): Promise<string> {
  if (!archivo.type.startsWith('image/')) throw new Error('Eso no es una imagen.')
  if (archivo.size > MAX_BYTES) throw new Error('La imagen no puede pesar más de 3 MB.')

  const chico = await achicar(archivo)
  // El nombre lleva la hora: si no, el navegador y el CDN seguirían mostrando
  // la imagen vieja después de cambiarla.
  const ruta = `grifo-${grifoId}/${Date.now()}.webp`

  const { error } = await supabase.storage.from(BUCKET)
    .upload(ruta, chico, { contentType: 'image/webp', upsert: true })
  if (error) throw new Error(error.message)

  return supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl
}

function achicar(archivo: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(archivo)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const escala = Math.min(1, MAX_LADO / Math.max(img.width, img.height))
      const cv = document.createElement('canvas')
      cv.width = Math.round(img.width * escala)
      cv.height = Math.round(img.height * escala)
      cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height)
      cv.toBlob(b => b ? resolve(b) : reject(new Error('No pudimos procesar la imagen.')),
                'image/webp', 0.86)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No pudimos leer la imagen.')) }
    img.src = url
  })
}
