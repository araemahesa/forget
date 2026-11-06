//! Numeric ring validation runs before Blender. Boundaries may not cross or touch.
type Point = [f64; 2];
const EPSILON: f64 = 1e-9;

pub fn valid_reconstruction(spec: &serde_json::Value) -> bool {
    let range=|v:&serde_json::Value,min:f64,max:f64|v.as_f64().is_some_and(|n|n.is_finite() && n>=min && n<=max);
    let Some(object)=spec.as_object() else{return false;};
    let Some(views)=spec["views"].as_array() else{return false;};
    if object.len()!=2 || !spec["resolution"].as_u64().is_some_and(|n|[64,96,128].contains(&n)) || !(2..=6).contains(&views.len()) {return false;}
    let mut seen=std::collections::HashSet::new();let mut axes=std::collections::HashSet::new();
    for view in views {
        let Some(v)=view.as_object() else{return false;};
        let Some(name)=view["view"].as_str() else{return false;};
        let Some(crop)=view["crop"].as_array() else{return false;};
        let Some(background)=view["background"].as_str() else{return false;};
        if v.len()!=5 || !view["image"].as_u64().is_some_and(|i|i<=11) || !["front","back","right","left","top","bottom"].contains(&name) || !seen.insert(name)
            || crop.len()!=4 || !crop.iter().all(|n|range(n,0.,1.)) || !range(&crop[2],0.02,1.) || !range(&crop[3],0.02,1.)
            || crop[0].as_f64().unwrap()+crop[2].as_f64().unwrap()>1.+EPSILON || crop[1].as_f64().unwrap()+crop[3].as_f64().unwrap()>1.+EPSILON
            || !(background=="alpha" || (background.len()==7 && background.starts_with('#') && background[1..].bytes().all(|b|b.is_ascii_hexdigit()))) || !range(&view["tolerance"],0.01,0.4) {return false;}
        axes.insert(match name {"front"|"back"=>0,"left"|"right"=>1,_=>2});
    }
    axes.len()>=2
}

pub fn valid_custom_shape(p:&serde_json::Value)->bool {
    let range=|v:&serde_json::Value,min:f64,max:f64|v.as_f64().is_some_and(|n|n.is_finite() && n>=min && n<=max);
    if p["primitive"] == "lathe" {
        let Some(l)=p["lathe"].as_object() else{return false;};
        let Some(points)=p["lathe"]["points"].as_array() else{return false;};
        if l.len()!=1 || !(3..=128).contains(&points.len()) || !points.iter().all(|p|p.as_array().is_some_and(|p|p.len()==2 && range(&p[0],0.,1.) && range(&p[1],-1.,1.))) {return false;}
        let radius=points.iter().map(|p|p[0].as_f64().unwrap()).fold(0.,f64::max);
        let low=points.iter().map(|p|p[1].as_f64().unwrap()).fold(f64::INFINITY,f64::min);
        let high=points.iter().map(|p|p[1].as_f64().unwrap()).fold(f64::NEG_INFINITY,f64::max);
        return radius>=1e-6 && high-low>=1e-6 && !points.windows(2).any(|w|(w[0][0].as_f64().unwrap()-w[1][0].as_f64().unwrap()).hypot(w[0][1].as_f64().unwrap()-w[1][1].as_f64().unwrap())<1e-9);
    }
    if p["primitive"] == "mesh" {
        let Some(m)=p["mesh"].as_object() else{return false;};
        let Some(v)=p["mesh"]["vertices"].as_array() else{return false;};
        let Some(faces)=p["mesh"]["faces"].as_array() else{return false;};
        if m.len()!=2 || !(4..=2048).contains(&v.len()) || !(1..=4096).contains(&faces.len()) || !v.iter().all(|p|p.as_array().is_some_and(|p|p.len()==3 && p.iter().all(|n|range(n,-1.,1.)))) {return false;}
        for axis in 0..3 {
            let low=v.iter().map(|p|p[axis].as_f64().unwrap()).fold(f64::INFINITY,f64::min);
            let high=v.iter().map(|p|p[axis].as_f64().unwrap()).fold(f64::NEG_INFINITY,f64::max);
            if high-low<1e-6 {return false;}
        }
        let mut used=std::collections::HashSet::new();let mut seen=std::collections::HashSet::new();
        for face in faces {
            let Some(indices)=face.as_array() else{return false;};
            if ![3,4].contains(&indices.len()) || !indices.iter().all(|i|i.as_u64().is_some_and(|i|i<(v.len() as u64))) {return false;}
            let indices:Vec<_>=indices.iter().map(|i|i.as_u64().unwrap() as usize).collect();
            if indices.iter().collect::<std::collections::HashSet<_>>().len()!=indices.len() {return false;}
            let mut key=indices.clone();key.sort_unstable();if !seen.insert(key) {return false;}used.extend(indices.iter().copied());
            for tri in if indices.len()==4 {vec![[indices[0],indices[1],indices[2]],[indices[0],indices[2],indices[3]]]} else {vec![[indices[0],indices[1],indices[2]]]} {
                let a=&v[tri[0]];let b=&v[tri[1]];let c=&v[tri[2]];
                let u:Vec<_>=(0..3).map(|i|b[i].as_f64().unwrap()-a[i].as_f64().unwrap()).collect();
                let w:Vec<_>=(0..3).map(|i|c[i].as_f64().unwrap()-a[i].as_f64().unwrap()).collect();
                if ((u[1]*w[2]-u[2]*w[1]).powi(2)+(u[2]*w[0]-u[0]*w[2]).powi(2)+(u[0]*w[1]-u[1]*w[0]).powi(2)).sqrt()<1e-9 {return false;}
            }
        }
        if used.len()!=v.len(){return false;}
    }
    true
}
fn cross(a:Point,b:Point,c:Point)->f64 {(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])}
fn intersects(a:Point,b:Point,c:Point,d:Point)->bool {
    let on=|p:Point,q:Point,r:Point|cross(p,q,r).abs()<=EPSILON && (0..2).all(|i|r[i]>=p[i].min(q[i])-EPSILON && r[i]<=p[i].max(q[i])+EPSILON);
    let side=|v:f64|if v>EPSILON {1} else if v< -EPSILON {-1} else {0};
    (side(cross(a,b,c))*side(cross(a,b,d))<0 && side(cross(c,d,a))*side(cross(c,d,b))<0) || on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b)
}
fn inside(p:Point,ring:&[Point])->bool {
    let mut hit=false;
    for i in 0..ring.len() {
        let a=ring[i];let b=ring[(i+ring.len()-1)%ring.len()];
        if (a[1]>p[1]) != (b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0] {hit= !hit;}
    }
    hit
}
/// Call after checking ring sizes and finite XY coordinates.
pub fn valid(rings:&[Vec<Point>])->bool {
    for ring in rings {
        for i in 0..ring.len() {
            let next=(i+1)%ring.len();
            if (ring[i][0]-ring[next][0]).hypot(ring[i][1]-ring[next][1])<=EPSILON {return false;}
            for j in i+1..ring.len() {
                if j!=next && (j+1)%ring.len()!=i && intersects(ring[i],ring[next],ring[j],ring[(j+1)%ring.len()]) {return false;}
            }
        }
    }
    for i in 1..rings.len() {
        if !inside(rings[i][0],&rings[0]) {return false;}
        for j in 0..i {
            if j>0 && (inside(rings[i][0],&rings[j]) || inside(rings[j][0],&rings[i])) {return false;}
            for a in 0..rings[i].len() {for b in 0..rings[j].len() {
                if intersects(rings[i][a],rings[i][(a+1)%rings[i].len()],rings[j][b],rings[j][(b+1)%rings[j].len()]) {return false;}
            }}
        }
    }
    true
}

#[cfg(test)]
mod tests {
    #[test]
    fn reconstruction_contract_matches_frontend_cases() {
        let cases:serde_json::Value=serde_json::from_str(include_str!("../../../../../packages/contracts/src/model3d-reconstruction-cases.json")).unwrap();
        for case in cases.as_array().unwrap() {
            let part=serde_json::json!({"id":"body","name":"Body","primitive":"reconstruction","position":[0,0,0],"size":[3,3,2],"rotation":[0,0,0],"color":"#666666","material":"Plastic","reconstruction":case["reconstruction"]});
            let doc=serde_json::json!({"kind":"model3d","recipe":{"name":"Reference","category":"prop","seed":0,"exportFormat":"blend","parts":[part]}});
            assert_eq!(crate::creative::validate_document(&doc,128).is_ok(),case["valid"].as_bool().unwrap(),"{}",case["name"]);
        }
    }
    #[test]
    fn custom_mesh_and_lathe_match_frontend_cases() {
        let cases:serde_json::Value=serde_json::from_str(include_str!("../../../../../packages/contracts/src/model3d-shape-cases.json")).unwrap();
        for case in cases.as_array().unwrap() {
            let mut part=serde_json::json!({"id":"shape","name":"Shape","primitive":case["primitive"],"position":[0,0,0],"size":[1,2,1],"rotation":[0,0,0],"color":"#246bb3","material":"Plastic"});
            part[case["primitive"].as_str().unwrap()]=case[case["primitive"].as_str().unwrap()].clone();
            if case.get("segments").is_some(){part["segments"]=case["segments"].clone();}
            let doc=serde_json::json!({"kind":"model3d","recipe":{"name":"Shape","category":"prop","seed":0,"exportFormat":"blend","parts":[part]}});
            assert_eq!(crate::creative::validate_document(&doc,128).is_ok(),case["valid"].as_bool().unwrap(),"{}",case["name"]);
        }
    }
    #[test]
    fn frontend_and_native_share_profile_acceptance_cases() {
        let cases:serde_json::Value=serde_json::from_str(include_str!("../../../../../packages/contracts/src/model3d-profile-cases.json")).unwrap();
        for case in cases.as_array().unwrap() {
            let document=serde_json::json!({"kind":"model3d","recipe":{"name":"Contour case","category":"prop","seed":0,"exportFormat":"glb","parts":[{"id":"a","name":"Contour","primitive":"profile","position":[0,0,0],"size":[1,1,0.1],"rotation":[0,0,0],"color":"#246bb3","material":"Metal","profile":{"outline":case["outline"],"holes":case["holes"],"bevel":0}}]}});
            assert_eq!(crate::creative::validate_document(&document,128).is_ok(),case["valid"].as_bool().unwrap(),"{}",case["name"]);
        }
    }
}
