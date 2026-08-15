import { renderSkybox } from '/objects/skybox.js';
import { renderAxis } from '/objects/axis.js';
import { renderGrid } from '/objects/grid.js';
import { renderVector } from '/objects/vector.js';
import { renderVectors } from '/objects/vectors.js';
import { renderPoint } from '/objects/point.js';
import { renderLine } from '/objects/line.js';
import { renderSurface } from '/objects/surface.js';
import { renderParametricCurve } from '/objects/parametric-curve.js';
import { renderParametricSurface } from '/objects/parametric-surface.js';
import { renderSphere } from '/objects/sphere.js';
import { renderEllipsoid } from '/objects/ellipsoid.js';
import { renderVectorField } from '/objects/vector-field.js';
import { renderPlane } from '/objects/plane.js';
import { renderText } from '/objects/text.js';
import { renderAnimatedVector } from '/objects/animated-vector.js';
import { renderPolygon } from '/objects/polygon.js';
import { renderAnimatedLine } from '/objects/animated-line.js';
import { renderAnimatedPoint } from '/objects/animated-point.js';
import { renderCylinder } from '/objects/cylinder.js';
import { renderAnimatedCylinder } from '/objects/animated-cylinder.js';
import { renderAnimatedPolygon } from '/objects/animated-polygon.js';
import { renderAnimatedCurve } from '/objects/animated-curve.js';

export function renderElement(el, view) {
    switch (el.type) {
        case 'skybox': return renderSkybox(el);
        case 'axis': return renderAxis(el, view);
        case 'grid': return renderGrid(el, view);
        case 'vector': return renderVector(el, view);
        case 'point': return renderPoint(el, view);
        case 'line': return renderLine(el, view);
        case 'surface': return renderSurface(el, view);
        case 'parametric_curve': return renderParametricCurve(el, view);
        case 'parametric_surface': return renderParametricSurface(el, view);
        case 'sphere': return renderSphere(el, view);
        case 'ellipsoid': return renderEllipsoid(el, view);
        case 'vectors': return renderVectors(el, view);
        case 'vector_field': return renderVectorField(el, view);
        case 'plane': return renderPlane(el, view);
        case 'polygon': return renderPolygon(el, view);
        case 'cylinder': return renderCylinder(el, view);
        case 'text': return renderText(el, view);
        case 'animated_vector': return renderAnimatedVector(el, view);
        case 'animated_line': return renderAnimatedLine(el, view);
        case 'animated_point': return renderAnimatedPoint(el, view);
        case 'animated_cylinder': return renderAnimatedCylinder(el, view);
        case 'animated_polygon': return renderAnimatedPolygon(el, view);
        case 'animated_curve': return renderAnimatedCurve(el, view);
        default:
            console.warn('Unknown element type:', el.type);
            return null;
    }
}
