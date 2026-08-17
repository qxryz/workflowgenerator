import type { CharacterRigState } from "../schema/directorProject";
import { ProceduralMannequin } from "./mannequin/ProceduralMannequin";
import type { CharacterBodyType } from "./mannequin/bodyTypes";

interface PrimitiveMannequinProps {
  bodyType?: CharacterBodyType;
  color?: string;
  rigState?: CharacterRigState;
}

export function PrimitiveMannequin({ bodyType, color = "#4F8EF7", rigState }: PrimitiveMannequinProps) {
  return <ProceduralMannequin bodyType={bodyType} color={color} rigState={rigState} />;
}
