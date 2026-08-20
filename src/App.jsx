/**
 * src/App.jsx
 * ---------------------------------------------------------------------------
 * Componente raíz de React. Compone la cáscara estática completa de la app
 * (mapa + panel lateral + barra móvil + diálogos por portal). Todo son
 * componentes memoizados sin props: React renderiza el DOM una sola vez y la
 * lógica vanilla (js/*.js) sigue enlazando por ids/clases sin conflictos.
 * ---------------------------------------------------------------------------
 */
import MapaFull from './components/shell/MapaFull';
import PanelLateral from './components/shell/PanelLateral';
import BarraMovil from './components/shell/BarraMovil';
import Dialogos from './components/shell/Dialogos';
import TransportSelector from './components/TransportSelector';
import MunicipioCombos from './components/MunicipioCombo';
import ParadasLista from './components/ParadasLista';
import SitiosLista from './components/SitiosLista';
import BuscarLugarLista from './components/BuscarLugarLista';
import AltimetriaSegmentos from './components/AltimetriaSegmentos';
import CategoriasGrid from './components/CategoriasGrid';
import PopupSitio from './components/PopupSitio';
import MenuFila from './components/MenuFila';
import CuadroInfo from './components/CuadroInfo';
import MenuAltimetria from './components/MenuAltimetria';
import BannerComparar from './components/BannerComparar';
import TourDestinosLista from './components/TourDestinosLista';
import InfraListado from './components/InfraListado';

export default function App() {
  return (
    <>
      <div className="app-body">
        <MapaFull />
        <PanelLateral />
      </div>
      <BarraMovil />
      <Dialogos />
      <TransportSelector />
      <MunicipioCombos />
      <ParadasLista />
      <SitiosLista />
      <BuscarLugarLista />
      <AltimetriaSegmentos />
      <CategoriasGrid />
      <PopupSitio />
      <MenuFila />
      <CuadroInfo />
      <MenuAltimetria />
      <BannerComparar />
      <TourDestinosLista />
      <InfraListado />
    </>
  );
}