import { useState, useRef } from 'react';
import { View, TouchableOpacity, Text } from 'react-native';
import { CameraView } from 'expo-camera';
import type { CameraView as CameraViewType } from 'expo-camera';
import { PinchGestureHandler, State } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { styles } from './styles';

type Props = {
  insetsBottom: number;
  cameraRef: React.RefObject<CameraViewType | null>;
  facing: 'back' | 'front';
  setFacing: React.Dispatch<React.SetStateAction<'back' | 'front'>>;
  closeLegacyCamera: () => void;
  takeLegacyPicture: () => void;
  pickImage: () => void;
  pickPdf: () => void;
};

export default function LegacyCamera({
  insetsBottom, cameraRef, facing, setFacing,
  closeLegacyCamera, takeLegacyPicture, pickImage, pickPdf,
}: Props) {
  // Local zoom state
  const [zoom, setZoom] = useState(0);
  const baseZoom = useRef(0);

  const zoomIn = () => setZoom(prev => { const n = Math.min(prev + 0.1, 1); baseZoom.current = n; return n; });
  const zoomOut = () => setZoom(prev => { const n = Math.max(prev - 0.1, 0); baseZoom.current = n; return n; });
  const onPinchEvent = (event: any) => setZoom(Math.max(0, Math.min(1, baseZoom.current + (event.nativeEvent.scale - 1) * 0.5)));
  const onPinchStateChange = (event: any) => { if (event.nativeEvent.state === State.END) baseZoom.current = zoom; };

  return (
    <View style={styles.cameraContainer}>
      <PinchGestureHandler onGestureEvent={onPinchEvent} onHandlerStateChange={onPinchStateChange}>
        <View style={{ flex: 1 }}>
          <CameraView style={styles.camera} facing={facing} ref={cameraRef} zoom={zoom} />
        </View>
      </PinchGestureHandler>

      <TouchableOpacity style={{position: 'absolute', top: 16, left: 16}} onPress={closeLegacyCamera}>
        <Ionicons name="close-circle" size={32} color="#fff" />
      </TouchableOpacity>
      
      <TouchableOpacity style={{position: 'absolute', top: 16, right: 16}} onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')}>
        <Ionicons name="camera-reverse-outline" size={32} color="#fff" />
      </TouchableOpacity>

      <View style={styles.zoomControls}>
        <TouchableOpacity style={styles.zoomBtn} onPress={zoomIn}><Ionicons name="add" size={24} color="#fff" /></TouchableOpacity>
        <View style={styles.zoomTextContainer}><Text style={styles.zoomText}>{(zoom * 4 + 1).toFixed(1)}x</Text></View>
        <TouchableOpacity style={styles.zoomBtn} onPress={zoomOut}><Ionicons name="remove" size={24} color="#fff" /></TouchableOpacity>
      </View>

      <View style={[styles.camControls, { paddingBottom: insetsBottom + 10 }]}>
        <TouchableOpacity style={styles.ctrlBtn} onPress={pickImage}>
          <Ionicons name="images-outline" size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.shutter} onPress={takeLegacyPicture}>
          <View style={styles.shutterRing}><View style={styles.shutterCore} /></View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlBtn} onPress={pickPdf}>
          <Ionicons name="document-text-outline" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}
